use crate::{process::DriverProcess, process::ProcessManager, repository::EngineRepository};
use anyhow::Result;
use chrono::Utc;
use florca_core::run::{RunId, RunRequest};
use serde_json::Value;
use std::{env, os::unix::process::ExitStatusExt, path::Path, process::ExitStatus, sync::Arc};
use tracing::{debug, error};

mod driver_command;
pub mod driver_events;

#[derive(Debug, Clone)]
pub struct DriverManager {
    run_id: RunId,
    process_manager: Arc<ProcessManager>,
    repository: Arc<dyn EngineRepository>,
}

impl DriverManager {
    pub fn new(
        run_id: RunId,
        process_manager: Arc<ProcessManager>,
        repository: Arc<dyn EngineRepository>,
    ) -> Self {
        Self {
            run_id,
            process_manager,
            repository,
        }
    }

    async fn add_pending_driver_process(&self, pid: u32) -> Result<()> {
        let mut lock = self.process_manager.driver_processes().write().await;
        lock.insert(self.run_id, DriverProcess { pid, port: None });
        Ok(())
    }

    async fn remove_driver_process(&self) -> Result<()> {
        self.process_manager
            .driver_processes()
            .write()
            .await
            .remove(&self.run_id);
        Ok(())
    }

    pub async fn run_workflow(
        self,
        run_request: RunRequest,
        temporary_directory_path: &Path,
    ) -> Result<()> {
        let command_result = self
            .run_driver(run_request, temporary_directory_path)
            .await?;
        self.remove_driver_process().await?;
        self.process_driver_process_result(command_result).await?;
        Ok(())
    }

    async fn run_driver(
        &self,
        run_request: RunRequest,
        temporary_directory_path: &Path,
    ) -> Result<ExitStatus> {
        let original_deno_lock_path = env::current_dir()?.join("deno.lock");
        let temporary_deno_lock_dir = tempfile::tempdir()?;
        let temporary_deno_lock_path = temporary_deno_lock_dir.path().join("deno.lock");
        tokio::fs::copy(&original_deno_lock_path, &temporary_deno_lock_path).await?;

        let mut command = driver_command::spawn_driver(
            run_request,
            temporary_directory_path,
            self.run_id,
            &temporary_deno_lock_path,
        )?;
        let pid = command.id().ok_or_else(|| {
            anyhow::anyhow!(
                "Failed to get PID for driver process with run ID {}",
                self.run_id
            )
        })?;
        self.add_pending_driver_process(pid).await?;
        Ok(command.wait().await?)
    }

    async fn process_driver_process_result(&self, command_result: ExitStatus) -> Result<()> {
        let run_id = self.run_id;

        if command_result.success() {
            debug!(run = %run_id, "Driver process completed");
            return Ok(());
        }

        let error_payload = if let Some(15) = command_result.signal() {
            error!(run = %run_id, "Driver process was killed");
            serde_json::json!({
                "kind": "DriverProcessKilled",
                "message": "Driver process was killed"
            })
        } else if let Some(signal) = command_result.signal() {
            error!(
                run = %run_id,
                signal, "Driver process exited due to signal"
            );
            serde_json::json!({
                "kind": "DriverProcessSignal",
                "message": format!("Driver process exited due to signal {signal}"),
                "signal": signal
            })
        } else if let Some(code) = command_result.code() {
            error!(
                run = %run_id,
                code, "Driver process exited with non-zero status"
            );
            serde_json::json!({
                "kind": "DriverProcessExitCode",
                "message": format!("Driver process exited with status code {code}"),
                "exitCode": code
            })
        } else {
            error!(run = %run_id, "Driver process exited abnormally");
            serde_json::json!({
                "kind": "DriverProcessAbnormalExit",
                "message": "Driver process exited abnormally"
            })
        };

        self.finalize_run(false, &error_payload).await?;

        Ok(())
    }

    async fn finalize_run(&self, success: bool, output: &Value) -> Result<()> {
        self.repository
            .finalize_run(success, self.run_id, output, Utc::now())
            .await?;
        Ok(())
    }
}
