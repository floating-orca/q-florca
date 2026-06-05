use crate::function::FunctionName;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use sqlx::Row;
use sqlx::postgres::PgRow;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(sqlx::FromRow)]
pub struct RawFunctionEntity {
    pub id: i32,
    pub deployment_id: i32,
    pub name: FunctionName,
    pub kind: String,
    pub location: String,
    pub hash: Option<String>,
    pub blob: Option<Vec<u8>>,
    pub invoke_queue_arn: Option<String>,
    pub invoke_esm_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FunctionEntity {
    Aws(RawFunctionEntity),
    Kn(RawFunctionEntity),
    Plugin(RawFunctionEntity),
}

impl<'a> From<&'a FunctionEntity> for &'a RawFunctionEntity {
    fn from(entity: &'a FunctionEntity) -> Self {
        match entity {
            FunctionEntity::Aws(aws) => aws,
            FunctionEntity::Kn(kn) => kn,
            FunctionEntity::Plugin(plugin) => plugin,
        }
    }
}

impl FunctionEntity {
    #[must_use]
    pub fn raw(&self) -> &RawFunctionEntity {
        match self {
            FunctionEntity::Aws(aws) => aws,
            FunctionEntity::Kn(kn) => kn,
            FunctionEntity::Plugin(plugin) => plugin,
        }
    }
}

impl FromRow<'_, PgRow> for FunctionEntity {
    fn from_row(row: &PgRow) -> sqlx::Result<Self> {
        let kind: String = row.try_get("kind")?;
        match kind.as_str() {
            "aws" => Ok(Self::Aws(RawFunctionEntity::from_row(row)?)),
            "kn" => Ok(Self::Kn(RawFunctionEntity::from_row(row)?)),
            "plugin" => Ok(Self::Plugin(RawFunctionEntity::from_row(row)?)),
            _ => panic!("Unknown function type: {kind}"),
        }
    }
}
