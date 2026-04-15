use chrono::{DateTime, Utc};
use florca_core::{function::FunctionName, invocation::InvocationId};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub enum DriverEvent {
    Log(LogEvent),
    #[serde(untagged)]
    Invocation(InvocationEvent),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[derive(TS)]
pub enum InvocationEvent {
    InvocationSuccess(InvocationSuccessEvent),
    InvocationFailure(InvocationFailureEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub struct InvocationSuccessEvent {
    pub id: InvocationId,
    pub parent: Option<InvocationId>,
    pub predecessor: Option<InvocationId>,
    pub function_name: FunctionName,
    pub input: Value,
    pub params: Value,
    pub output: Value,
    pub start_time: DateTime<Utc>,
    pub end_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub struct InvocationFailureEvent {
    pub id: InvocationId,
    pub parent: Option<InvocationId>,
    pub predecessor: Option<InvocationId>,
    pub function_name: FunctionName,
    pub input: Value,
    pub params: Value,
    pub start_time: DateTime<Utc>,
    pub error: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "scope", rename_all = "camelCase")]
#[derive(TS)]
pub enum LogEvent {
    Workflow(WorkflowLogMessage),
    Invocation(InvocationLogMessage),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub struct WorkflowLogMessage {
    pub level: LogLevel,
    pub message: String,
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
pub struct InvocationLogMessage {
    pub level: LogLevel,
    pub message: String,
    pub data: Option<Value>,
    pub invocation_id: InvocationId,
    pub function_name: FunctionName,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
#[derive(TS)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}
