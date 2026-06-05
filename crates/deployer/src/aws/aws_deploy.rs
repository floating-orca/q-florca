use crate::aws::aws_client::AwsClient;
use crate::aws::aws_qualifier::{Arn, AwsFunctionQualifier};
use crate::detect::RemoteFunctionToDeploy;
use anyhow::Result;
use florca_core::deployment::DeploymentName;
use florca_core::function::AwsFunctionConfig;
use std::path::Path;
use std::path::PathBuf;
use tempfile::{NamedTempFile, TempDir};
use tracing::debug;
use tracing::info;

/// Lambda wrapper templates — embedded so the deployer binary is self-contained.
const WRAPPER_INDEX_JS: &str = include_str!("../../../../templates/aws/nodejs24.x/index.js");
const WRAPPER_FN_JS: &str    = include_str!("../../../../templates/aws/nodejs24.x/fn.js");

pub async fn deploy_aws_function(
    remote_function_to_deploy: &RemoteFunctionToDeploy,
    aws_function_config: &AwsFunctionConfig,
    previous_hash: Option<String>,
    deployment_name: &DeploymentName,
    aws_client: &dyn AwsClient,
    lookup_json_path: &Path,
) -> Result<Arn> {
    let implementation_path = Path::new(&remote_function_to_deploy.path).join("aws");
    let named_zip_file = zip_aws_function_with_wrapper(
        &implementation_path,
        &aws_function_config.runtime,
        lookup_json_path,
    )?;
    let zip_path = named_zip_file.path();
    let aws_function_qualifier =
        AwsFunctionQualifier::new(deployment_name, &remote_function_to_deploy.name);
    let existing_function = aws_client
        .find_deployed_function(&aws_function_qualifier)
        .await?;
    let hash = &remote_function_to_deploy.hash;
    if let Some(previous_hash) = &previous_hash {
        debug!(
            previous = previous_hash,
            new = hash,
            "Comparing hashes for {}",
            &remote_function_to_deploy.name
        );
        if previous_hash == hash
            && let Some(existing_function) = &existing_function
        {
            return Ok(existing_function.clone());
        }
    }
    info!("Deploying aws remote function {:?}", &implementation_path);
    let aws_function = if let Some(existing_function) = existing_function {
        aws_client
            .update_function(&aws_function_qualifier, aws_function_config, zip_path)
            .await?;
        existing_function.clone()
    } else {
        aws_client
            .create_function(&aws_function_qualifier, aws_function_config, zip_path)
            .await?
    };
    tokio::fs::remove_file(zip_path).await?;
    Ok(aws_function)
}

/// Package a Lambda ZIP with the system wrapper injected.
/// Convention: user writes `index.{js,py}`; at pack time it is renamed
/// to `_index.{js,py}` and the wrapper is written as `index.{js,py}`.
/// `lookup.json` is also bundled from `lookup_json_path`.
fn zip_aws_function_with_wrapper(
    implementation_path: &PathBuf,
    runtime: &str,
    lookup_json_path: &Path,
) -> Result<NamedTempFile> {
    let staging = TempDir::new()?;
    fs_extra::dir::copy(
        implementation_path,
        staging.path(),
        &fs_extra::dir::CopyOptions::new()
            .copy_inside(true)
            .overwrite(true)
            .content_only(true),
    )?;
    if !runtime.starts_with("nodejs") {
        anyhow::bail!("AWS deployments support only Node.js runtimes; got `{runtime}`");
    }
    let user_index = staging.path().join("index.js");
    if !user_index.exists() {
        anyhow::bail!("Expected index.js in {:?} but it was not found", implementation_path);
    }
    std::fs::rename(&user_index, staging.path().join("_index.js"))?;
    std::fs::write(staging.path().join("index.js"), WRAPPER_INDEX_JS)?;
    std::fs::write(staging.path().join("fn.js"), WRAPPER_FN_JS)?;
    std::fs::copy(lookup_json_path, staging.path().join("lookup.json"))?;
    let named_zip_file = tempfile::NamedTempFile::with_suffix(".zip")?;
    zip_extensions::zip_writer::zip_create_from_directory(
        &named_zip_file.path().to_path_buf(),
        &staging.path().to_path_buf(),
    )?;
    Ok(named_zip_file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_aws_function_with_wrapper_missing_index_returns_err() {
        let dir = tempfile::tempdir().unwrap();
        let lookup = tempfile::NamedTempFile::new().unwrap();
        let result = zip_aws_function_with_wrapper(
            &dir.path().to_path_buf(),
            "nodejs24.x",
            lookup.path(),
        );
        assert!(result.is_err());
        let msg = format!("{}", result.unwrap_err());
        assert!(msg.contains("Expected index.js"), "error message was: {msg}");
    }
}
