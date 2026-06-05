use anyhow::{Context, Result};
use create_deployment_params::{CreateDeploymentParams, FunctionToCreate};
use florca_core::{
    deployment::{DeploymentEntity, DeploymentName},
    function::FunctionEntity,
};
use sqlx::postgres::PgPoolOptions;
use std::{env, fmt::Debug};

#[async_trait::async_trait]
pub trait DeployerRepository: Debug + Send + Sync {
    async fn get_deployments(&self) -> Result<Vec<DeploymentEntity>>;
    async fn insert_deployment_with_functions(&self, params: &CreateDeploymentParams)
    -> Result<()>;
    async fn get_deployment(
        &self,
        deployment_name: &DeploymentName,
    ) -> Result<Option<DeploymentEntity>>;
    async fn get_functions(&self, deployment_id: i32) -> Result<Vec<FunctionEntity>>;
    async fn delete_deployment(&self, deployment_name: &DeploymentName) -> Result<()>;
}

#[derive(Debug)]
pub struct SqlxDeployerRepository {
    pool: sqlx::PgPool,
}

impl SqlxDeployerRepository {
    /// # Panics
    ///
    /// Panics if the `DEPLOYER_DATABASE_URL` environment variable is not set.
    pub async fn setup() -> Result<Self> {
        let database_url =
            env::var("DEPLOYER_DATABASE_URL").expect("DEPLOYER_DATABASE_URL must be set");
        Self::setup_with_database_url(&database_url).await
    }

    pub async fn setup_with_database_url(database_url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(5)
            .connect(database_url)
            .await?;
        sqlx::migrate!("./migrations").run(&pool).await?;
        Ok(Self { pool })
    }
}

#[async_trait::async_trait]
impl DeployerRepository for SqlxDeployerRepository {
    async fn get_deployments(&self) -> Result<Vec<DeploymentEntity>> {
        let deployments = sqlx::query_as::<_, DeploymentEntity>(
            "select id, name, events_queue_arn from deployments",
        )
        .fetch_all(&self.pool)
        .await
        .context("Failed to fetch deployments")?;
        Ok(deployments)
    }

    async fn insert_deployment_with_functions(
        &self,
        params: &CreateDeploymentParams,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let deployment_id: i32 = sqlx::query_scalar(
            "insert into deployments (name, events_queue_arn) \
             values ($1, $2) returning id",
        )
        .bind(&params.name)
        .bind(params.config.events_queue_arn.as_ref())
        .fetch_one(&mut *tx)
        .await?;
        for f in &params.functions {
            match f {
                FunctionToCreate::Aws(f) => {
                    let query = "insert into functions \
                        (deployment_id, name, kind, location, hash, \
                         invoke_queue_arn, invoke_esm_uuid) \
                        values ($1, $2, $3, $4, $5, $6, $7)";
                    sqlx::query(query)
                        .bind(deployment_id)
                        .bind(&f.name)
                        .bind("aws")
                        .bind(&f.arn)
                        .bind(&f.hash)
                        .bind(f.invoke_queue_arn.as_ref())
                        .bind(f.invoke_esm_uuid.as_ref())
                        .execute(&mut *tx)
                        .await?;
                }
                FunctionToCreate::Kn(f) => {
                    let query = "insert into functions (deployment_id, name, kind, location, hash) values ($1, $2, $3, $4, $5)";
                    sqlx::query(query)
                        .bind(deployment_id)
                        .bind(&f.name)
                        .bind("kn")
                        .bind(&f.url)
                        .bind(&f.hash)
                        .execute(&mut *tx)
                        .await?;
                }
                FunctionToCreate::Plugin(f) => {
                    let query = "insert into functions (deployment_id, name, kind, location, blob) values ($1, $2, $3, $4, $5)";
                    sqlx::query(query)
                        .bind(deployment_id)
                        .bind(&f.name)
                        .bind("plugin")
                        .bind(&f.file_name)
                        .bind(Some(f.blob.as_slice()))
                        .execute(&mut *tx)
                        .await?;
                }
            }
        }
        tx.commit().await?;
        Ok(())
    }

    async fn get_deployment(
        &self,
        deployment_name: &DeploymentName,
    ) -> Result<Option<DeploymentEntity>> {
        let deployment = sqlx::query_as::<_, DeploymentEntity>(
            "select id, name, events_queue_arn from deployments where name = $1",
        )
        .bind(deployment_name.as_ref())
        .fetch_optional(&self.pool)
        .await
        .context("Failed to fetch deployment")?;
        Ok(deployment)
    }

    async fn get_functions(&self, deployment_id: i32) -> Result<Vec<FunctionEntity>> {
        let functions = sqlx::query_as::<_, FunctionEntity>(
            "select id, deployment_id, name, kind, location, hash, blob, \
                    invoke_queue_arn, invoke_esm_uuid \
             from functions where deployment_id = $1",
        )
        .bind(deployment_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(functions)
    }

    async fn delete_deployment(&self, deployment_name: &DeploymentName) -> Result<()> {
        sqlx::query("delete from deployments where name = $1")
            .bind(deployment_name.as_ref())
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

pub mod create_deployment_params {

    use florca_core::deployment::DeploymentConfig;
    use florca_core::function::FunctionName;

    pub struct AwsFunctionToCreate {
        pub name: FunctionName,
        pub arn: String,
        pub hash: String,
        pub invoke_queue_arn: Option<String>,
        pub invoke_esm_uuid: Option<String>,
    }

    pub struct KnFunctionToCreate {
        pub name: FunctionName,
        pub url: String,
        pub hash: String,
    }

    pub struct PluginFunctionToCreate {
        pub name: FunctionName,
        pub file_name: String,
        pub blob: Vec<u8>,
    }

    pub enum FunctionToCreate {
        Aws(AwsFunctionToCreate),
        Kn(KnFunctionToCreate),
        Plugin(PluginFunctionToCreate),
    }

    pub struct CreateDeploymentParams {
        pub name: String,
        pub functions: Vec<FunctionToCreate>,
        pub config: DeploymentConfig,
    }

    impl CreateDeploymentParams {
        #[must_use]
        pub fn new(
            name: String,
            functions: Vec<FunctionToCreate>,
            config: DeploymentConfig,
        ) -> Self {
            CreateDeploymentParams {
                name,
                functions,
                config,
            }
        }
    }
}
