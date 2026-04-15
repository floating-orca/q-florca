use crate::{
    deployer_client::DeployerClient,
    driver::DriverManager,
    error::{ReportError, RunWorkflowError},
    event_processor::EventProcessor,
    process::ProcessManager,
    repository::{EngineRepository, GetRunByIdError},
};
use anyhow::{Context, Result};
use chrono::Utc;
use florca_core::{
    driver::DriverResult,
    http::RequestBuilderExt,
    lookup::LookupEntry,
    run::{RunId, RunRequest},
};
use reqwest::Client;
use serde_json::Value;
use std::sync::Arc;
use tempfile::{NamedTempFile, TempDir};
use tracing::{debug, error};

#[derive(Debug, Clone)]
pub struct RunService {
    process_manager: Arc<ProcessManager>,
    repository: Arc<dyn EngineRepository>,
    deployer_client: Arc<dyn DeployerClient>,
    http_client: Client,
}

impl RunService {
    pub fn new(
        process_manager: Arc<ProcessManager>,
        repository: Arc<dyn EngineRepository>,
        deployer_client: Arc<dyn DeployerClient>,
    ) -> Self {
        Self {
            process_manager,
            repository,
            deployer_client,
            http_client: Client::new(),
        }
    }

    pub async fn run_workflow(&self, run_request: RunRequest) -> Result<RunId, RunWorkflowError> {
        let zip = self.fetch_and_store(&run_request).await?;
        let temporary_directory = extract(&zip)?;
        if !is_entry_point_present(&run_request, temporary_directory.path()).await? {
            return Err(RunWorkflowError::EntryPointNotFound(
                run_request.entry_point,
            ));
        }
        let run_id = self.repository.new_run(&run_request, Utc::now()).await?;
        let driver_manager = DriverManager::new(
            run_id,
            self.process_manager.clone(),
            self.repository.clone(),
        );
        tokio::spawn(async move {
            let temporary_directory_path = temporary_directory.path();
            if let Err(err) = driver_manager
                .run_workflow(run_request, temporary_directory_path)
                .await
            {
                error!(run = %run_id, ?err, "Driver task failed");
            }
        });
        Ok(run_id)
    }

    pub async fn report_readiness(&self, run_id: RunId, port: u16) -> Result<(), ReportError> {
        let mut lock = self.process_manager.driver_processes().write().await;
        let driver_process = lock
            .get_mut(&run_id)
            .ok_or_else(|| ReportError::NotFound(run_id))?;
        driver_process.port = Some(port);
        Ok(())
    }

    pub async fn invoke_child(
        &self,
        run_id: RunId,
        invoke_child_args: Value,
    ) -> Result<Value, RunWorkflowError> {
        let port = self
            .process_manager
            .get_port_for_run(run_id)
            .await
            .context("No driver process found for run")?;
        let url = format!("http://localhost:{port}/invoke");
        let response = self
            .http_client
            .post(url)
            .with_basic_auth_from_env()
            .json(&invoke_child_args)
            .send()
            .await
            .context("Failed to send request")?;
        if response.content_length() == Some(0) {
            return Ok(Value::Null);
        }
        let value = response
            .json::<Value>()
            .await
            .context("Failed to parse response")?;
        Ok(value)
    }

    pub async fn run_exists(&self, run_id: RunId) -> Result<bool> {
        match self.repository.get_run_by_id(run_id).await {
            Ok(_) => Ok(true),
            Err(GetRunByIdError::NotFound(_)) => Ok(false),
            Err(GetRunByIdError::Other(err)) => Err(err),
        }
    }

    pub fn new_event_processor(&self, run_id: RunId) -> EventProcessor {
        EventProcessor::new(run_id, self.repository.clone())
    }

    pub async fn finalize_run(&self, run_id: RunId, driver_result: DriverResult) -> Result<()> {
        match driver_result {
            DriverResult::Success(success_details) => {
                debug!(run = %run_id, "Processing successful workflow result");
                self.repository
                    .finalize_run(true, run_id, &success_details.value, Utc::now())
                    .await
                    .with_context(|| format!("Failed to finalize successful run {run_id}"))?;
            }
            DriverResult::Error(error_details) => {
                error!(run = %run_id, "Processing failed workflow result");
                let error_value = serde_json::to_value(&error_details).unwrap_or_else(|_| {
                    serde_json::json!({
                        "kind": error_details.kind,
                        "message": error_details.message
                    })
                });
                self.repository
                    .finalize_run(false, run_id, &error_value, Utc::now())
                    .await
                    .with_context(|| format!("Failed to finalize failed run {run_id}"))?;
            }
        }
        Ok(())
    }

    async fn fetch_and_store(
        &self,
        run_request: &RunRequest,
    ) -> Result<NamedTempFile, RunWorkflowError> {
        let zip_bytes = self
            .deployer_client
            .fetch_deployment_zip(&run_request.deployment_name)
            .await?;
        let zip_named = NamedTempFile::with_suffix(".zip")?;
        tokio::fs::write(zip_named.path(), zip_bytes).await?;
        Ok(zip_named)
    }
}

fn extract(zip_named: &NamedTempFile) -> Result<TempDir> {
    let temporary_directory = TempDir::with_prefix("deployment-")?;
    zip_extensions::zip_extract::zip_extract(
        &zip_named.path().to_path_buf(),
        &temporary_directory.path().to_path_buf(),
    )
    .with_context(|| "Failed to extract zip")?;
    Ok(temporary_directory)
}

async fn is_entry_point_present(
    run_request: &RunRequest,
    temporary_directory_path: &std::path::Path,
) -> Result<bool, RunWorkflowError> {
    let lookup_json =
        tokio::fs::read_to_string(temporary_directory_path.join("lookup.json")).await?;
    let lookup: Vec<LookupEntry> =
        serde_json::from_str(&lookup_json).context("Failed to parse lookup.json")?;
    let contains_entry_point = lookup
        .iter()
        .any(|entry| entry.name == run_request.entry_point);
    Ok(contains_entry_point)
}
