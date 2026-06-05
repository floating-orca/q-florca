use crate::{
    deployment::DeploymentName, function::FunctionName, invocation::InvocationId,
    lookup::LookupManifest, run::RunId,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct DriverArgs {
    pub run_id: RunId,
    pub deployment_name: DeploymentName,
    pub deployment_path: PathBuf,
    pub entry_point: FunctionName,
    pub input: Value,
    pub params: Value,
    pub lookup_manifest: LookupManifest,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct ReportReadinessRequest {
    pub port: u16,
    pub run_id: RunId,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct InvokeChildArgs {
    pub function_name: FunctionName,
    pub input: Value,
    pub params: Value,
    pub parent: InvocationId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub enum DriverResult {
    Error(DriverErrorDetails),
    Success(DriverSuccessDetails),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub struct DriverErrorDetails {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub struct DriverSuccessDetails {
    pub value: Value,
}
