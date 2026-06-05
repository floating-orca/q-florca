use anyhow::Result;
use florca_core::{
    deployment::DeploymentConfig,
    function::FunctionEntity,
    lookup::{LookupEntry, LookupManifest, arn_to_queue_url},
};
use std::path::Path;
use tempfile::{NamedTempFile, TempDir};
use tokio::fs::{self, File};

pub async fn pack_deployment(
    functions: Vec<FunctionEntity>,
    config: DeploymentConfig,
) -> Result<File> {
    let work_dir = tempfile::tempdir()?;
    let manifest = build_manifest(&functions, &config)?;
    generate_lookup_file(&work_dir.path().join("lookup.json"), &manifest).await?;
    query_blobs_and_write_files(&work_dir, functions).await?;
    let named_zip_file = NamedTempFile::with_suffix(".zip")?;
    zip_extensions::zip_writer::zip_create_from_directory(
        &named_zip_file.path().to_path_buf(),
        &work_dir.path().to_path_buf(),
    )
    .map_err(|e| anyhow::anyhow!(e))?;
    let file = File::open(&named_zip_file).await?;
    Ok(file)
}

pub fn build_manifest(functions: &[FunctionEntity], config: &DeploymentConfig) -> Result<LookupManifest> {
    let events_queue_url = config
        .events_queue_arn
        .as_deref()
        .map(arn_to_queue_url)
        .transpose()?
        .unwrap_or_default();
    let entries: Vec<LookupEntry> = functions
        .iter()
        .map(|f| LookupEntry::from_raw_with_urls(f.raw()))
        .collect();
    Ok(LookupManifest {
        events_queue_url,
        entries,
    })
}

async fn generate_lookup_file(lookup_path: &Path, manifest: &LookupManifest) -> Result<()> {
    fs::write(lookup_path, serde_json::to_string_pretty(manifest)?).await?;
    Ok(())
}

async fn query_blobs_and_write_files(
    work_dir: &TempDir,
    functions: Vec<FunctionEntity>,
) -> Result<()> {
    for function in functions {
        if let FunctionEntity::Plugin(plugin) = function {
            let file_path = work_dir.path().join(&plugin.location);
            fs::write(&file_path, &plugin.blob.unwrap()).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use florca_core::function::{FunctionEntity, RawFunctionEntity};
    use serde_json::json;
    use zip::ZipArchive;

    fn make_raw(
        id: i32,
        name: &str,
        kind: &str,
        location: &str,
        invoke_queue_arn: Option<&str>,
    ) -> RawFunctionEntity {
        RawFunctionEntity {
            id,
            deployment_id: 1,
            name: name.into(),
            kind: kind.to_string(),
            location: location.to_string(),
            hash: None,
            blob: None,
            invoke_queue_arn: invoke_queue_arn.map(ToString::to_string),
            invoke_esm_uuid: None,
        }
    }

    #[tokio::test]
    async fn test_pack_deployment() {
        let functions = vec![
            FunctionEntity::Plugin(RawFunctionEntity {
                id: 1,
                deployment_id: 1,
                name: "test_function".into(),
                kind: "plugin".to_string(),
                location: "test_location.ts".to_string(),
                hash: None,
                blob: Some(vec![1, 2, 3, 4]),
                invoke_queue_arn: None,
                invoke_esm_uuid: None,
            }),
            FunctionEntity::Aws(make_raw(
                2,
                "test_aws_function",
                "aws",
                "arn::aws:lambda:eu-central-1:123456789012:function:test_deployment-test_aws_function",
                None,
            )),
        ];

        let file = pack_deployment(functions, DeploymentConfig::default())
            .await
            .unwrap();
        assert!(file.metadata().await.is_ok());

        let std_file = file.into_std().await;
        let temp_dir = TempDir::new().unwrap();
        let mut zip = ZipArchive::new(std_file).unwrap();
        zip.extract(temp_dir.path()).unwrap();

        let lookup_path = temp_dir.path().join("lookup.json");
        assert!(lookup_path.exists());
        let content = fs::read_to_string(lookup_path).await.unwrap();
        let val: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert!(val.get("eventsQueueUrl").is_some());
        assert!(val["entries"].as_array().unwrap().len() == 2);

        let file_path = temp_dir.path().join("test_location.ts");
        assert!(file_path.exists());
        let file_content = fs::read(file_path).await.unwrap();
        assert_eq!(file_content, vec![1, 2, 3, 4]);
    }

    #[tokio::test]
    async fn test_pack_deployment_emits_queue_urls() {
        let region = "eu-central-1";
        let account = "123456789012";
        let d = "d";
        let f = "fn";
        let invoke_arn = format!("arn:aws:sqs:{region}:{account}:florca-{d}-{f}-invoke");
        let events_arn = format!("arn:aws:sqs:{region}:{account}:florca-{d}-events");

        let functions = vec![FunctionEntity::Aws(make_raw(
            1,
            f,
            "aws",
            &format!("arn:aws:lambda:{region}:{account}:function:{d}-{f}"),
            Some(&invoke_arn),
        ))];
        let config = DeploymentConfig {
            events_queue_arn: Some(events_arn.clone()),
        };
        let file = pack_deployment(functions, config).await.unwrap();
        let std_file = file.into_std().await;
        let temp_dir = TempDir::new().unwrap();
        ZipArchive::new(std_file).unwrap().extract(temp_dir.path()).unwrap();
        let content = fs::read_to_string(temp_dir.path().join("lookup.json")).await.unwrap();
        assert!(content.contains("eventsQueueUrl"));
        assert!(content.contains("invokeQueueUrl"));
        assert!(!content.contains("mailboxQueueUrl"));
        assert!(!content.contains("aggregatedQueueUrl"));
        assert!(content.contains("sqs.eu-central-1.amazonaws.com"));
    }
}
