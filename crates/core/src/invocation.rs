use crate::{function::FunctionName, run::RunId};
use chrono::{DateTime, Utc};
use derive_more::Display;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct InvocationEntity {
    pub id: InvocationId,
    pub parent: Option<InvocationId>,
    pub predecessor: Option<InvocationId>,
    pub run_id: RunId,
    pub function_name: FunctionName,
    pub input: Value,
    pub params: Value,
    pub output: Option<Value>,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
}

#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Display,
    sqlx::Type,
)]
#[sqlx(transparent, type_name = "UUID")]
#[derive(TS)]
pub struct InvocationId(Uuid);

impl InvocationId {
    /// Create a new invocation ID with a random UUID
    #[must_use]
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}
