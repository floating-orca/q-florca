use anyhow::Result;
use florca_core::function::{AwsFunctionConfig, FunctionName};
use florca_deployer::aws::{
    AwsClient,
    aws_qualifier::{Arn, AwsFunctionQualifier},
};
use std::{path::Path, sync::Arc};
use tokio::sync::RwLock;
use florca_core::deployment::DeploymentName;

#[derive(Debug)]
pub struct MockAwsClient {
    pub functions: Arc<RwLock<Vec<AwsFunctionQualifier>>>,
    pub queues: Arc<RwLock<Vec<String>>>,
    pub event_source_mappings: Arc<RwLock<Vec<String>>>,
}

impl MockAwsClient {
    pub fn new() -> Self {
        Self {
            functions: Arc::new(RwLock::new(vec![])),
            queues: Arc::new(RwLock::new(vec![])),
            event_source_mappings: Arc::new(RwLock::new(vec![])),
        }
    }
}

#[async_trait::async_trait]
impl AwsClient for MockAwsClient {
    async fn create_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
        _aws_function_config: &AwsFunctionConfig,
        _zip_path: &Path,
    ) -> Result<Arn> {
        let mut functions = self.functions.write().await;
        functions.push(aws_function_qualifier.clone());
        Ok(Arn(format!(
            "arn:aws:lambda:eu-central-1:123456789012:function:{aws_function_qualifier}"
        )))
    }

    async fn find_deployed_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
    ) -> Result<Option<Arn>> {
        let functions = self.functions.read().await;
        let arn = functions
            .iter()
            .find(|f| f == &aws_function_qualifier)
            .map(|f| {
                Arn(format!(
                    "arn:aws:lambda:eu-central-1:123456789012:function:{f}"
                ))
            });
        Ok(arn)
    }

    async fn update_function(
        &self,
        _aws_function_qualifier: &AwsFunctionQualifier,
        _aws_function_config: &AwsFunctionConfig,
        _zip_path: &Path,
    ) -> Result<()> {
        Ok(())
    }

    #[allow(unused_variables)]
    async fn delete_function(&self, aws_function_qualifier: &AwsFunctionQualifier) -> Result<()> {
        let mut functions = self.functions.write().await;
        functions.retain(|f| f != aws_function_qualifier);
        Ok(())
    }

    async fn create_invocation_queue(
        &self,
        deployment: &DeploymentName,
        function: &FunctionName,
        _timeout: i32,
    ) -> Result<String> {
        let arn = format!(
            "arn:aws:sqs:eu-central-1:123456789012:florca-{deployment}-{function}-invoke"
        );
        self.queues.write().await.push(arn.clone());
        Ok(arn)
    }

    async fn create_events_queue(&self, deployment: &DeploymentName) -> Result<String> {
        let arn = format!(
            "arn:aws:sqs:eu-central-1:123456789012:florca-{deployment}-events"
        );
        self.queues.write().await.push(arn.clone());
        Ok(arn)
    }

    #[allow(unused_variables)]
    async fn create_event_source_mapping(&self, queue_arn: &str, function_arn: &str) -> Result<String> {
        let uuid = format!(
            "esm-{}",
            self.event_source_mappings.read().await.len() + 1
        );
        self.event_source_mappings.write().await.push(uuid.clone());
        Ok(uuid)
    }

    async fn delete_queue(&self, queue_arn: &str) -> Result<()> {
        self.queues.write().await.retain(|q| q != queue_arn);
        Ok(())
    }

    async fn delete_event_source_mapping(&self, uuid: &str) -> Result<()> {
        self.event_source_mappings
            .write()
            .await
            .retain(|u| u != uuid);
        Ok(())
    }
}
