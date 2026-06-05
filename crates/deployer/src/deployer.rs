use crate::aws::AwsClient;
use crate::aws::aws_qualifier::AwsFunctionQualifier;
use crate::detect::{FunctionToDeploy, PluginFunctionToDeploy};
use crate::errors::DeployError;
use crate::kn::KnClient;
use crate::kn::kn_qualifier::KnFunctionQualifier;
use crate::repository::DeployerRepository;
use crate::repository::create_deployment_params::{
    AwsFunctionToCreate, CreateDeploymentParams, FunctionToCreate, KnFunctionToCreate,
    PluginFunctionToCreate,
};
use anyhow::{Context, Result};
use florca_core::deployment::{DeploymentConfig, DeploymentEntity, DeploymentName};
use florca_core::function::{FunctionConfig, FunctionEntity, FunctionName};
use florca_core::lookup::{LookupEntry, LookupManifest, LookupEntryKind, arn_to_queue_url};
use std::collections::HashMap;
use std::fs::File;
use std::{io::Write, path::Path, sync::Arc};
use tempfile::{NamedTempFile, TempDir};
use tracing::info;
use zip::ZipArchive;

#[derive(Debug, Clone)]
pub struct Deployer {
    pub repository: Arc<dyn DeployerRepository>,
    pub aws_client: Arc<dyn AwsClient>,
    pub kn_client: Arc<dyn KnClient>,
}

impl Deployer {
    pub fn new(
        repository: Arc<dyn DeployerRepository>,
        aws_client: Arc<dyn AwsClient>,
        kn_client: Arc<dyn KnClient>,
    ) -> Self {
        Self {
            repository,
            aws_client,
            kn_client,
        }
    }

    pub async fn deploy(
        &self,
        bytes: &[u8],
        deployment_name: &DeploymentName,
        force: bool,
    ) -> Result<(), DeployError> {
        let mut zip_file = tempfile::tempfile()?;
        zip_file.write_all(bytes)?;
        let temp_deployment_dir = extract_zip(&zip_file)?;
        self.deploy_dir(temp_deployment_dir.path(), deployment_name, force)
            .await?;
        info!(
            deployment = deployment_name.to_string(),
            "Deployment successful"
        );
        Ok(())
    }

    async fn deploy_dir(
        &self,
        source_deployment_path: &Path,
        deployment_name: &DeploymentName,
        force: bool,
    ) -> Result<(), DeployError> {
        let functions_to_deploy: Vec<FunctionToDeploy> =
            crate::detect::detect_functions(source_deployment_path).await?;

        let mut previous_function_entities: Vec<FunctionEntity> = Vec::new();
        if let Some(deployment) = self.repository.get_deployment(deployment_name).await? {
            let existing_function_entities = self.repository.get_functions(deployment.id).await?;
            self.repository.delete_deployment(deployment_name).await?;
            self.undeploy_old_functions(
                &deployment,
                &existing_function_entities,
                &functions_to_deploy,
            )
            .await?;
            previous_function_entities = existing_function_entities;
        }

        // Provision the shared events queue once per deployment.
        let events_queue_arn = self.aws_client.create_events_queue(deployment_name).await?;
        let events_queue_url = arn_to_queue_url(&events_queue_arn)?;

        // Provision per-function queues for all AWS functions first, so we
        // can build a complete lookup.json before packaging any Lambda ZIP.
        let mut aws_queues: HashMap<FunctionName, AwsFunctionQueues> = HashMap::new();
        for function_to_deploy in &functions_to_deploy {
            if let FunctionToDeploy::Remote(remote) = function_to_deploy {
                if let FunctionConfig::Aws(aws_config) = &remote.config {
                    let invoke_queue_arn = self
                        .aws_client
                        .create_invocation_queue(deployment_name, &remote.name, aws_config.timeout)
                        .await?;
                    aws_queues.insert(remote.name.clone(), AwsFunctionQueues {
                        invoke_queue_arn,
                    });
                }
            }
        }

        // Build lookup.json with all queue URLs.
        let lookup_json_path = build_lookup_json(
            &functions_to_deploy,
            &aws_queues,
            &events_queue_url,
        ).await?;

        let mut functions_to_create: Vec<FunctionToCreate> = Vec::new();
        for function_to_deploy in &functions_to_deploy {
            functions_to_create.push(
                self.deploy_function(
                    deployment_name,
                    &previous_function_entities,
                    function_to_deploy,
                    force,
                    &aws_queues,
                    lookup_json_path.path(),
                )
                .await?,
            );
        }

        self.repository
            .insert_deployment_with_functions(&CreateDeploymentParams::new(
                deployment_name.as_ref().clone(),
                functions_to_create,
                DeploymentConfig {
                    events_queue_arn: Some(events_queue_arn),
                },
            ))
            .await?;

        Ok(())
    }

    async fn undeploy_old_functions(
        &self,
        deployment: &DeploymentEntity,
        existing_function_entities: &[FunctionEntity],
        functions_to_deploy: &[FunctionToDeploy],
    ) -> Result<()> {
        for function_entity in existing_function_entities {
            let still_relevant = still_relevant(functions_to_deploy, function_entity);
            if !still_relevant {
                match function_entity {
                    FunctionEntity::Aws(aws) => {
                        self.aws_client
                            .delete_function(&AwsFunctionQualifier::new(
                                &deployment.name,
                                &aws.name,
                            ))
                            .await?;
                    }
                    FunctionEntity::Kn(kn) => {
                        self.kn_client
                            .delete_kn_function(&KnFunctionQualifier::new(
                                &deployment.name,
                                &kn.name,
                            ))
                            .await?;
                    }
                    FunctionEntity::Plugin(_plugin) => {}
                }
            }
        }
        Ok(())
    }

    async fn deploy_function(
        &self,
        deployment_name: &DeploymentName,
        previous_function_entities: &[FunctionEntity],
        function_to_deploy: &FunctionToDeploy,
        force: bool,
        aws_queues: &HashMap<FunctionName, AwsFunctionQueues>,
        lookup_json_path: &Path,
    ) -> Result<FunctionToCreate, DeployError> {
        let function_to_create = match function_to_deploy {
            FunctionToDeploy::Remote(remote_function_to_deploy) => {
                let function_entity = previous_function_entities
                    .iter()
                    .find(|e| e.raw().name == remote_function_to_deploy.name);
                let previous_hash = if force {
                    None
                } else {
                    function_entity.and_then(|e| e.raw().hash.clone())
                };
                match &remote_function_to_deploy.config {
                    FunctionConfig::Aws(aws_function_config) => {
                        let queues = aws_queues
                            .get(&remote_function_to_deploy.name)
                            .expect("queues provisioned for all AWS functions");
                        let arn = crate::aws::deploy_aws_function(
                            remote_function_to_deploy,
                            aws_function_config,
                            previous_hash,
                            deployment_name,
                            self.aws_client.as_ref(),
                            lookup_json_path,
                        )
                        .await?;

                        let invoke_esm_uuid = self
                            .aws_client
                            .create_event_source_mapping(&queues.invoke_queue_arn, &arn.0)
                            .await?;

                        FunctionToCreate::Aws(AwsFunctionToCreate {
                            name: remote_function_to_deploy.name.clone(),
                            arn: arn.0,
                            hash: remote_function_to_deploy.hash.clone(),
                            invoke_queue_arn: Some(queues.invoke_queue_arn.clone()),
                            invoke_esm_uuid: Some(invoke_esm_uuid),
                        })
                    }
                    FunctionConfig::Kn(kn_function_config) => {
                        let url = crate::kn::deploy_kn_function(
                            remote_function_to_deploy,
                            kn_function_config,
                            previous_hash,
                            deployment_name,
                            self.kn_client.as_ref(),
                        )
                        .await?;
                        FunctionToCreate::Kn(KnFunctionToCreate {
                            name: remote_function_to_deploy.name.clone(),
                            url: url.0,
                            hash: remote_function_to_deploy.hash.clone(),
                        })
                    }
                }
            }
            FunctionToDeploy::Plugin(plugin_function_to_deploy) => {
                deploy_plugin(plugin_function_to_deploy).await?
            }
        };
        Ok(function_to_create)
    }
}

struct AwsFunctionQueues {
    invoke_queue_arn: String,
}

/// Build a temporary lookup.json containing queue URLs for all functions.
async fn build_lookup_json(
    functions_to_deploy: &[FunctionToDeploy],
    aws_queues: &HashMap<FunctionName, AwsFunctionQueues>,
    events_queue_url: &str,
) -> Result<NamedTempFile, DeployError> {
    let entries: Vec<LookupEntry> = functions_to_deploy
        .iter()
        .map(|f| {
            let name = f.name().clone();
            match f {
                FunctionToDeploy::Remote(remote) => {
                    let (kind, invoke_queue_url) =
                        match &remote.config {
                            FunctionConfig::Aws(_) => {
                                let q = aws_queues.get(&name).unwrap();
                                (
                                    LookupEntryKind::Aws,
                                    Some(arn_to_queue_url(&q.invoke_queue_arn)
                                        .map_err(|e| DeployError::Other(e.into()))?),
                                )
                            }
                            FunctionConfig::Kn(_) => (LookupEntryKind::Kn, None),
                        };
                    Ok(LookupEntry {
                        name,
                        kind,
                        location: String::new(), // not needed at runtime inside Lambda
                        invoke_queue_url,
                    })
                }
                FunctionToDeploy::Plugin(_) => Ok(LookupEntry {
                    name,
                    kind: LookupEntryKind::Plugin,
                    location: String::new(),
                    invoke_queue_url: None,
                }),
            }
        })
        .collect::<Result<Vec<_>, DeployError>>()?;

    let manifest = LookupManifest {
        events_queue_url: events_queue_url.to_string(),
        entries,
    };

    let tmp = tempfile::Builder::new()
        .suffix(".json")
        .tempfile()
        .map_err(|e| DeployError::Other(e.into()))?;
    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| DeployError::Other(e.into()))?;
    tokio::fs::write(tmp.path(), json)
        .await
        .map_err(|e| DeployError::Other(e.into()))?;
    Ok(tmp)
}

fn still_relevant(
    functions_to_deploy: &[FunctionToDeploy],
    function_entity: &FunctionEntity,
) -> bool {
    functions_to_deploy.iter().any(|f| {
        if let FunctionToDeploy::Remote(remote_function_to_deploy) = f {
            match &remote_function_to_deploy.config {
                FunctionConfig::Aws(_aws_function_config) => {
                    return matches!(function_entity, FunctionEntity::Aws(_))
                        && f.name() == &function_entity.raw().name;
                }
                FunctionConfig::Kn(_kn_function_config) => {
                    return matches!(function_entity, FunctionEntity::Kn(_))
                        && f.name() == &function_entity.raw().name;
                }
            }
        }
        false
    })
}

async fn deploy_plugin(
    plugin_function_to_deploy: &PluginFunctionToDeploy,
) -> Result<FunctionToCreate, DeployError> {
    let function_to_create = FunctionToCreate::Plugin(PluginFunctionToCreate {
        name: plugin_function_to_deploy.name.clone(),
        file_name: plugin_function_to_deploy
            .path
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string(),
        blob: tokio::fs::read(&plugin_function_to_deploy.path).await?,
    });
    Ok(function_to_create)
}

fn extract_zip(zip_file: &File) -> Result<TempDir, DeployError> {
    let temp_deployment_dir = tempfile::tempdir()?;
    let mut zip_archive = ZipArchive::new(zip_file).context("Failed to open zip file")?;
    zip_archive
        .extract(temp_deployment_dir.path())
        .context("Failed to extract zip file")?;
    Ok(temp_deployment_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::detect::RemoteFunctionToDeploy;
    use florca_core::function::AwsFunctionConfig;

    #[tokio::test]
    async fn build_lookup_json_malformed_arn_returns_err() {
        use std::path::PathBuf;
        let name = FunctionName::from("start");
        let function = FunctionToDeploy::Remote(RemoteFunctionToDeploy {
            name: name.clone(),
            path: PathBuf::from("start"),
            hash: "abc".to_string(),
            config: FunctionConfig::Aws(AwsFunctionConfig {
                handler: "index.handler".to_string(),
                runtime: "nodejs24.x".to_string(),
                memory: 128,
                timeout: 3,
            }),
        });
        let mut aws_queues = HashMap::new();
        aws_queues.insert(name, AwsFunctionQueues {
            invoke_queue_arn: "not-a-valid-arn".to_string(),
        });
        let result = build_lookup_json(&[function], &aws_queues, "https://events").await;
        assert!(result.is_err());
    }
}
