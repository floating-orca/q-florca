use derive_more::{AsRef, Display, From};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct DeploymentEntity {
    pub id: i32,
    pub name: DeploymentName,
    #[sqlx(default)]
    pub events_queue_arn: Option<String>,
}

#[derive(
    Debug,
    Clone,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    From,
    AsRef,
    Display,
    sqlx::Type,
)]
#[sqlx(transparent, type_name = "TEXT")]
#[derive(TS)]
pub struct DeploymentName(String);

impl From<&str> for DeploymentName {
    fn from(name: &str) -> Self {
        Self(name.to_string())
    }
}
