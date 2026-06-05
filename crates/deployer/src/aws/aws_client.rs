use crate::aws::{aws_qualifier::Arn, aws_qualifier::AwsFunctionQualifier};
use florca_core::lookup::arn_to_queue_url;
use crate::errors::UserFacingError;
use anyhow::Result;
use aws_config::BehaviorVersion;
use aws_sdk_lambda::{
    client::Waiters,
    operation::delete_function::DeleteFunctionError,
    primitives::Blob,
    types::{Environment, FunctionCode, Runtime},
};
use florca_core::deployment::DeploymentName;
use florca_core::function::{AwsFunctionConfig, FunctionName};
use std::{env, fmt::Debug, path::Path, time::Duration};
use tracing::{error, info, warn};

#[async_trait::async_trait]
pub trait AwsClient: Debug + Send + Sync {
    async fn create_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
        aws_function_config: &AwsFunctionConfig,
        zip_path: &Path,
    ) -> Result<Arn>;
    async fn find_deployed_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
    ) -> Result<Option<Arn>>;
    async fn update_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
        aws_function_config: &AwsFunctionConfig,
        zip_path: &Path,
    ) -> Result<()>;
    async fn delete_function(&self, aws_function_qualifier: &AwsFunctionQualifier) -> Result<()>;

    /// Provision (or look up) the per-function SQS Standard invocation queue.
    /// The Lambda is triggered via an SQS-Lambda event source mapping.
    async fn create_invocation_queue(
        &self,
        deployment: &DeploymentName,
        function: &FunctionName,
        timeout: i32,
    ) -> Result<String>;

    /// Provision (or look up) the per-deployment SQS standard events queue.
    /// All Lambda wrappers emit observability events here.
    async fn create_events_queue(&self, deployment: &DeploymentName) -> Result<String>;

    /// Wire an SQS queue as the trigger for a Lambda. Returns the event
    /// source mapping UUID, persisted so we can delete it on undeploy.
    async fn create_event_source_mapping(
        &self,
        queue_arn: &str,
        function_arn: &str,
    ) -> Result<String>;

    /// Best-effort: tolerate "not found" so undeploy is idempotent.
    async fn delete_queue(&self, queue_arn: &str) -> Result<()>;

    /// Best-effort: tolerate "not found" so undeploy is idempotent.
    async fn delete_event_source_mapping(&self, uuid: &str) -> Result<()>;
}

#[derive(Debug)]
pub struct AwsClientImpl {
    client: aws_sdk_lambda::Client,
    sqs: aws_sdk_sqs::Client,
}

impl AwsClientImpl {
    pub async fn new() -> Self {
        let sdk_config = aws_config::defaults(BehaviorVersion::v2026_01_12())
            .load()
            .await;
        Self {
            client: aws_sdk_lambda::Client::new(&sdk_config),
            sqs: aws_sdk_sqs::Client::new(&sdk_config),
        }
    }
}

const SQS_NAME_PREFIX: &str = "florca";

fn invocation_queue_name(deployment: &DeploymentName, function: &FunctionName) -> String {
    format!(
        "{SQS_NAME_PREFIX}-{}-{}-invoke",
        deployment.as_ref(),
        function
    )
}

fn events_queue_name(deployment: &DeploymentName) -> String {
    format!("{SQS_NAME_PREFIX}-{}-events", deployment.as_ref())
}

/// SQS `GetQueueAttributes` returns the queue ARN; we ask for it after
/// `CreateQueue` (which only returns the URL).
async fn queue_url_to_arn(
    sqs: &aws_sdk_sqs::Client,
    queue_url: &str,
) -> Result<String> {
    let attrs = sqs
        .get_queue_attributes()
        .queue_url(queue_url)
        .attribute_names(aws_sdk_sqs::types::QueueAttributeName::QueueArn)
        .send()
        .await?;
    let arn = attrs
        .attributes()
        .and_then(|m| m.get(&aws_sdk_sqs::types::QueueAttributeName::QueueArn))
        .ok_or_else(|| anyhow::anyhow!("CreateQueue: no QueueArn attribute returned"))?;
    Ok(arn.clone())
}


#[async_trait::async_trait]
impl AwsClient for AwsClientImpl {
    async fn create_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
        aws_function_config: &AwsFunctionConfig,
        zip_path: &Path,
    ) -> Result<Arn> {
        let role = env::var("AWS_ROLE")?;
        if role.is_empty() {
            anyhow::bail!("AWS_ROLE environment variable must not be empty");
        }
        let result = self
            .client
            .create_function()
            .function_name(aws_function_qualifier.as_ref())
            .runtime(Runtime::from(aws_function_config.runtime.as_str()))
            .role(&role)
            .handler(&aws_function_config.handler)
            .code(
                FunctionCode::builder()
                    .zip_file(Blob::new(tokio::fs::read(zip_path).await?))
                    .build(),
            )
            .memory_size(aws_function_config.memory)
            .timeout(aws_function_config.timeout)
            .environment(
                Environment::builder()
                    .variables("FLORCA_FUNCTION_NAME", &aws_function_qualifier.function_name)
                    .build(),
            )
            .send()
            .await?;
        self.client
            .wait_until_function_active_v2()
            .function_name(aws_function_qualifier.as_ref())
            .wait(Duration::from_secs(10))
            .await?;
        let arn = result.function_arn.unwrap();
        Ok(Arn(arn))
    }

    async fn find_deployed_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
    ) -> Result<Option<Arn>> {
        use aws_sdk_lambda::operation::get_function::GetFunctionError;
        match self
            .client
            .get_function()
            .function_name(aws_function_qualifier.as_ref())
            .send()
            .await
        {
            Ok(result) => Ok(result
                .configuration
                .and_then(|c| c.function_arn)
                .map(Arn)),
            Err(e) => {
                if matches!(
                    e.as_service_error(),
                    Some(GetFunctionError::ResourceNotFoundException(_))
                ) {
                    Ok(None)
                } else {
                    Err(e.into())
                }
            }
        }
    }

    async fn update_function(
        &self,
        aws_function_qualifier: &AwsFunctionQualifier,
        aws_function_config: &AwsFunctionConfig,
        zip_path: &Path,
    ) -> Result<()> {
        self.client
            .update_function_configuration()
            .function_name(aws_function_qualifier.as_ref())
            .runtime(Runtime::from(aws_function_config.runtime.as_str()))
            .handler(&aws_function_config.handler)
            .memory_size(aws_function_config.memory)
            .timeout(aws_function_config.timeout)
            .environment(
                Environment::builder()
                    .variables("FLORCA_FUNCTION_NAME", &aws_function_qualifier.function_name)
                    .build(),
            )
            .send()
            .await?;
        self.client
            .wait_until_function_updated_v2()
            .function_name(aws_function_qualifier.as_ref())
            .wait(Duration::from_secs(10))
            .await?;
        self.client
            .update_function_code()
            .function_name(aws_function_qualifier.as_ref())
            .zip_file(Blob::new(tokio::fs::read(zip_path).await?))
            .send()
            .await?;
        self.client
            .wait_until_function_updated_v2()
            .function_name(aws_function_qualifier.as_ref())
            .wait(Duration::from_secs(10))
            .await?;
        Ok(())
    }

    async fn delete_function(&self, aws_function_qualifier: &AwsFunctionQualifier) -> Result<()> {
        let result = self
            .client
            .delete_function()
            .function_name(aws_function_qualifier.as_ref())
            .send()
            .await;

        if let Err(e) = result {
            if let Some(DeleteFunctionError::ResourceNotFoundException(_)) = e.as_service_error() {
                warn!(
                    function = aws_function_qualifier.as_ref(),
                    "Function not found"
                );
            } else {
                error!(
                    function = aws_function_qualifier.as_ref(),
                    "Error deleting AWS function: {}", e
                );
            }
        } else {
            info!(
                function = aws_function_qualifier.as_ref(),
                "Deleted AWS function"
            );
        }
        Ok(())
    }

    async fn create_invocation_queue(
        &self,
        deployment: &DeploymentName,
        function: &FunctionName,
        timeout: i32,
    ) -> Result<String> {
        use aws_sdk_sqs::types::QueueAttributeName;
        let name = invocation_queue_name(deployment, function);
        info!(queue = %name, "Provisioning SQS invocation queue (Standard)");
        let resp = self
            .sqs
            .create_queue()
            .queue_name(&name)
            .attributes(QueueAttributeName::VisibilityTimeout, &timeout.to_string())
            .send()
            .await
            .map_err(sqs_queue_error)?;
        let queue_url = resp
            .queue_url()
            .ok_or_else(|| anyhow::anyhow!("CreateQueue returned no URL"))?
            .to_string();
        queue_url_to_arn(&self.sqs, &queue_url).await
    }

    async fn create_events_queue(&self, deployment: &DeploymentName) -> Result<String> {
        let name = events_queue_name(deployment);
        info!(queue = %name, "Provisioning SQS events queue");
        let resp = self
            .sqs
            .create_queue()
            .queue_name(&name)
            .send()
            .await
            .map_err(sqs_queue_error)?;
        let queue_url = resp
            .queue_url()
            .ok_or_else(|| anyhow::anyhow!("CreateQueue returned no URL"))?
            .to_string();
        queue_url_to_arn(&self.sqs, &queue_url).await
    }

    async fn create_event_source_mapping(
        &self,
        queue_arn: &str,
        function_arn: &str,
    ) -> Result<String> {
        use aws_sdk_lambda::operation::create_event_source_mapping::CreateEventSourceMappingError;
        info!(
            queue = queue_arn,
            function = function_arn,
            "Wiring SQS-Lambda event source mapping"
        );
        match self
            .client
            .create_event_source_mapping()
            .event_source_arn(queue_arn)
            .function_name(function_arn)
            .batch_size(1)
            .send()
            .await
        {
            Ok(resp) => resp
                .uuid()
                .ok_or_else(|| anyhow::anyhow!("CreateEventSourceMapping returned no UUID"))
                .map(ToString::to_string),
            Err(e)
                if matches!(
                    e.as_service_error(),
                    Some(CreateEventSourceMappingError::ResourceConflictException(_))
                ) =>
            {
                // Mapping already exists — find and return the existing UUID.
                let existing = self
                    .client
                    .list_event_source_mappings()
                    .event_source_arn(queue_arn)
                    .function_name(function_arn)
                    .send()
                    .await?;
                existing
                    .event_source_mappings()
                    .first()
                    .and_then(|m| m.uuid())
                    .ok_or_else(|| anyhow::anyhow!("Existing event source mapping has no UUID"))
                    .map(ToString::to_string)
            }
            Err(e) => Err(e.into()),
        }
    }

    async fn delete_queue(&self, queue_arn: &str) -> Result<()> {
        let url = arn_to_queue_url(queue_arn)?;
        match self.sqs.delete_queue().queue_url(&url).send().await {
            Ok(_) => {
                info!(queue = queue_arn, "Deleted SQS queue");
                Ok(())
            }
            Err(e) => {
                let svc = e.as_service_error();
                if svc.is_some_and(aws_sdk_sqs::operation::delete_queue::DeleteQueueError::is_queue_does_not_exist) {
                    warn!(queue = queue_arn, "SQS queue not found (already deleted)");
                    Ok(())
                } else {
                    error!(queue = queue_arn, "Error deleting SQS queue: {}", e);
                    Err(e.into())
                }
            }
        }
    }

    async fn delete_event_source_mapping(&self, uuid: &str) -> Result<()> {
        match self
            .client
            .delete_event_source_mapping()
            .uuid(uuid)
            .send()
            .await
        {
            Ok(_) => {
                info!(uuid, "Deleted event source mapping");
                Ok(())
            }
            Err(e) => {
                use aws_sdk_lambda::operation::delete_event_source_mapping::DeleteEventSourceMappingError;
                if let Some(DeleteEventSourceMappingError::ResourceNotFoundException(_)) =
                    e.as_service_error()
                {
                    warn!(uuid, "Event source mapping not found (already deleted)");
                } else {
                    error!(uuid, "Error deleting event source mapping: {}", e);
                }
                Ok(())
            }
        }
    }
}

fn sqs_queue_error(
    e: aws_sdk_sqs::error::SdkError<aws_sdk_sqs::operation::create_queue::CreateQueueError>,
) -> anyhow::Error {
    use aws_sdk_sqs::operation::create_queue::CreateQueueError;
    if matches!(
        e.as_service_error(),
        Some(CreateQueueError::QueueDeletedRecently(_))
    ) {
        UserFacingError(
            "SQS queue was recently deleted; please wait 60 seconds and redeploy.".to_string(),
        )
        .into()
    } else {
        e.into()
    }
}
