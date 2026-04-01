use crate::kn::kn_qualifier::{KnFunctionQualifier, KnUrl};
use anyhow::Result;
use chrono::{DateTime, Utc};
use florca_core::function::KnFunctionConfig;
use std::env;
use std::fmt::Debug;
use std::{path::Path, process::Stdio};
use tokio::process::Command;
use tracing::{error, info};

#[async_trait::async_trait]
pub trait KnClient: Debug + Send + Sync {
    async fn create_kn_function(
        &self,
        kn_function_qualifier: &KnFunctionQualifier,
        kn_function_config: &KnFunctionConfig,
        implementation_path: &Path,
    ) -> Result<KnUrl>;

    async fn find_deployed_kn_function(
        &self,
        kn_function_qualifier: &KnFunctionQualifier,
    ) -> Result<Option<KnUrl>>;

    async fn delete_kn_function(&self, kn_function_qualifier: &KnFunctionQualifier) -> Result<()>;
}

#[derive(Debug)]
pub struct KnClientImpl;

impl Default for KnClientImpl {
    fn default() -> Self {
        Self::new()
    }
}

impl KnClientImpl {
    #[must_use]
    pub fn new() -> Self {
        Self
    }
}

#[async_trait::async_trait]
impl KnClient for KnClientImpl {
    async fn create_kn_function(
        &self,
        kn_function_qualifier: &KnFunctionQualifier,
        kn_function_config: &KnFunctionConfig,
        implementation_path: &Path,
    ) -> Result<KnUrl> {
        prepare_kn_function(
            kn_function_qualifier,
            kn_function_config,
            implementation_path,
        )
        .await?;

        let registry =
            env::var("CONTAINER_REGISTRY").unwrap_or_else(|_| "localhost:5001".to_string());

        let mut build_output = Command::new("func")
            .arg("build")
            .arg("-v")
            .arg("--path")
            .arg(implementation_path)
            .arg("--registry")
            .arg(&registry)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()?;

        let exit_status = build_output.wait().await?;

        if !exit_status.success() {
            anyhow::bail!("Error building Knative function {kn_function_qualifier}");
        }

        println!("Knative function {kn_function_qualifier} built successfully");

        let deploy_result = Command::new("func")
            .arg("deploy")
            .arg("--path")
            .arg(implementation_path)
            .arg("--registry")
            .arg(&registry)
            .output()
            .await;

        if let Err(e) = deploy_result {
            anyhow::bail!("Error deploying Knative function {kn_function_qualifier}: {e}");
        } else if !deploy_result.as_ref().unwrap().status.success() {
            anyhow::bail!(
                "Error deploying Knative function {}: {}",
                kn_function_qualifier,
                String::from_utf8_lossy(&deploy_result?.stderr)
            );
        }

        println!("Knative function {kn_function_qualifier} deployed successfully");

        let url = get_url_for_kn_function(kn_function_qualifier).await?;
        Ok(KnUrl(url))
    }

    async fn find_deployed_kn_function(
        &self,
        kn_function_qualifier: &KnFunctionQualifier,
    ) -> Result<Option<KnUrl>> {
        let output = Command::new("func")
            .arg("list")
            .arg("--output")
            .arg("json")
            .output()
            .await?;
        if !output.status.success() {
            anyhow::bail!(
                "Error listing Knative functions: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&output.stdout) else {
            // Fine, since `func` could print `no functions found in namespace 'default'` to stdout
            return Ok(None);
        };
        let deployed_functions: Vec<KnListOutputEntry> = serde_json::from_value(value)?;
        let deployed_function = deployed_functions
            .into_iter()
            .find(|f| &f.name == kn_function_qualifier.as_ref());
        Ok(deployed_function.map(|f| KnUrl(f.url)))
    }

    async fn delete_kn_function(&self, kn_function_qualifier: &KnFunctionQualifier) -> Result<()> {
        let result = Command::new("func")
            .arg("delete")
            .arg(kn_function_qualifier.as_ref())
            .output()
            .await;

        if let Err(e) = result {
            error!(
                function = kn_function_qualifier.as_ref(),
                "Error deleting Knative function: {}", e
            );
        } else if !result.as_ref().unwrap().status.success() {
            error!(
                function = kn_function_qualifier.as_ref(),
                "Error deleting Knative function: {}",
                String::from_utf8_lossy(&result?.stderr)
            );
        } else {
            info!(
                function = kn_function_qualifier.as_ref(),
                "Deleted Knative function"
            );
        }

        Ok(())
    }
}

#[derive(serde::Deserialize)]
struct KnListOutputEntry {
    name: String,
    // namespace: String,
    // runtime: String,
    url: String,
    // ready: String,
}

#[derive(serde::Deserialize)]
struct KnDescribeOutput {
    #[serde(rename = "Route")]
    route: String,
    // routes: Vec<String>,
    // name: String,
    // image: String,
    // namespace: String,
    // subscriptions: Vec<Value>,
}

async fn get_url_for_kn_function(kn_function_qualifier: &KnFunctionQualifier) -> Result<String> {
    let result = Command::new("func")
        .arg("describe")
        .arg(kn_function_qualifier.as_ref())
        .arg("--output")
        .arg("json")
        .output()
        .await?;
    if !result.status.success() {
        anyhow::bail!(
            "Could not find Knative function {}: {}",
            kn_function_qualifier,
            String::from_utf8_lossy(&result.stderr)
        );
    }
    let output: KnDescribeOutput = serde_json::from_slice(&result.stdout)?;
    Ok(output.route)
}

async fn prepare_kn_function(
    kn_function_qualifier: &KnFunctionQualifier,
    kn_function_config: &KnFunctionConfig,
    implementation_path: &Path,
) -> Result<()> {
    let func_yaml_path = Path::new(implementation_path).join("func.yaml");
    let date_time = DateTime::from_timestamp_nanos(0);
    let func_yaml = generate_func_yaml(kn_function_qualifier, kn_function_config, date_time);
    tokio::fs::write(func_yaml_path, func_yaml).await?;
    Ok(())
}

fn generate_func_yaml(
    kn_function_qualifier: &KnFunctionQualifier,
    kn_function_config: &KnFunctionConfig,
    created: DateTime<Utc>,
) -> String {
    let func_yaml = format!(
        r"specVersion: 0.36.0
name: {}
runtime: {}
created: {}
",
        kn_function_qualifier,
        kn_function_config.runtime,
        created.to_rfc3339_opts(chrono::SecondsFormat::Nanos, false),
    );
    func_yaml
}
