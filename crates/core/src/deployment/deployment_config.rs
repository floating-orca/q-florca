use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct DeploymentConfig {
    /// SQS standard queue ARN for the shared events stream. All Lambda
    /// wrappers in the deployment emit observability events here.
    /// `None` for Knative-only deployments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub events_queue_arn: Option<String>,
}
