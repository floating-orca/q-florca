use crate::function::{FunctionName, RawFunctionEntity};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct LookupManifest {
    /// URL of the shared SQS events queue for this deployment.
    /// All Lambda wrappers emit observability events here.
    pub events_queue_url: String,
    pub entries: Vec<LookupEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct LookupEntry {
    pub name: FunctionName,
    pub kind: LookupEntryKind,
    /// Lambda ARN (AWS) or HTTP URL (Knative).
    pub location: String,
    /// SQS Standard invoke queue URL. 
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub invoke_queue_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub enum LookupEntryKind {
    Aws,
    Kn,
    Plugin,
}

/// Convert an SQS ARN to a queue URL.
/// `arn:aws:sqs:<region>:<account>:<name>` →
/// `https://sqs.<region>.amazonaws.com/<account>/<name>`
pub fn arn_to_queue_url(arn: &str) -> anyhow::Result<String> {
    let parts: Vec<&str> = arn.split(':').collect();
    if parts.len() < 6 || parts[0] != "arn" || parts[2] != "sqs" {
        anyhow::bail!("invalid SQS ARN: {arn}");
    }
    Ok(format!(
        "https://sqs.{}.amazonaws.com/{}/{}",
        parts[3], parts[4], parts[5]
    ))
}

impl LookupEntry {
    pub fn from_raw_with_urls(entity: &RawFunctionEntity) -> Self {
        let invoke_queue_url = entity
            .invoke_queue_arn
            .as_deref()
            .and_then(|a| arn_to_queue_url(a).ok());
        Self {
            name: entity.name.clone(),
            kind: match entity.kind.as_str() {
                "aws" => LookupEntryKind::Aws,
                "kn" => LookupEntryKind::Kn,
                "plugin" => LookupEntryKind::Plugin,
                _ => panic!("Unknown function type: {}", entity.kind),
            },
            location: entity.location.clone(),
            invoke_queue_url,
        }
    }
}
