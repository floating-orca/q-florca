use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use florca_core::invocation::InvocationEntity;
use florca_core::run::{RunEntity, RunId, RunRequest};
use serde_json::Value;
use sqlx::QueryBuilder;
use sqlx::postgres::PgPoolOptions;
use std::{env, fmt::Debug};
use tracing::debug;

#[derive(Debug, thiserror::Error)]
pub enum GetLatestRunError {
    #[error("No latest run")]
    NoLatest,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum GetRunByIdError {
    #[error("Run {0} not found")]
    NotFound(RunId),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[async_trait::async_trait]
pub trait EngineRepository: Debug + Send + Sync {
    async fn get_latest_run(&self) -> Result<RunEntity, GetLatestRunError>;
    async fn get_run_by_id(&self, run_id: RunId) -> Result<RunEntity, GetRunByIdError>;
    async fn get_runs_without_end_time(&self) -> Result<Vec<RunEntity>>;
    async fn new_run(&self, run_request: &RunRequest, start_time: DateTime<Utc>) -> Result<RunId>;
    async fn get_invocations(&self, run_id: RunId) -> Result<Vec<InvocationEntity>>;
    async fn insert_invocations(&self, invocations: Vec<InvocationEntity>) -> Result<()>;
    async fn finalize_run(
        &self,
        success: bool,
        run_id: RunId,
        output: &Value,
        end_time: DateTime<Utc>,
    ) -> Result<()>;
}

#[derive(Debug)]
pub struct SqlxEngineRepository {
    pool: sqlx::PgPool,
}

impl SqlxEngineRepository {
    /// # Panics
    ///
    /// Panics if the `ENGINE_DATABASE_URL` environment variable is not set.
    pub async fn setup() -> Result<Self> {
        let database_url =
            env::var("ENGINE_DATABASE_URL").expect("ENGINE_DATABASE_URL must be set");
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
impl EngineRepository for SqlxEngineRepository {
    async fn get_latest_run(&self) -> Result<RunEntity, GetLatestRunError> {
        sqlx::query_as::<_, RunEntity>(
            "select id, deployment_name, entry_point, input, output, start_time, end_time, success from runs order by id desc limit 1",
        )
        .fetch_optional(&self.pool)
        .await
        .context("error fetching latest run")?
            .ok_or(GetLatestRunError::NoLatest)
    }

    async fn get_run_by_id(&self, run_id: RunId) -> Result<RunEntity, GetRunByIdError> {
        sqlx::query_as::<_, RunEntity>(
            "select id, deployment_name, entry_point, input, output, start_time, end_time, success from runs where id = $1",
        )
        .bind(run_id)
        .fetch_one(&self.pool)
        .await
            .map_err(|e| match e {
                sqlx::Error::RowNotFound => GetRunByIdError::NotFound(run_id),
                _ => GetRunByIdError::Other(e.into()),
            })
    }

    async fn get_runs_without_end_time(&self) -> Result<Vec<RunEntity>> {
        sqlx::query_as::<_, RunEntity>(
            "select id, deployment_name, entry_point, input, output, start_time, end_time, success from runs where end_time is null",
        )
            .fetch_all(&self.pool)
            .await
            .context("error fetching running runs")
    }

    async fn new_run(&self, run_request: &RunRequest, start_time: DateTime<Utc>) -> Result<RunId> {
        let run_id: RunId = sqlx::query_scalar(
            "insert into runs (deployment_name, entry_point, input, start_time) values ($1, $2, $3, $4) returning id",
        )
        .bind(&run_request.deployment_name)
        .bind(&run_request.entry_point)
        .bind(&run_request.input)
        .bind(start_time)
        .fetch_one(&self.pool)
        .await
        .context("error creating new run")?;
        Ok(run_id)
    }

    async fn get_invocations(&self, run_id: RunId) -> Result<Vec<InvocationEntity>> {
        sqlx::query_as::<_, InvocationEntity>(
            "select id, parent, predecessor, run_id, function_name, input, params, output, start_time, end_time from invocations where run_id = $1",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
        .context("error fetching invocations")
    }

    async fn insert_invocations(&self, invocations: Vec<InvocationEntity>) -> Result<()> {
        if invocations.is_empty() {
            return Ok(());
        }

        let mut query_builder = QueryBuilder::new(
            "INSERT INTO invocations (id, parent, predecessor, run_id, function_name, input, params, output, start_time, end_time)",
        );

        query_builder.push_values(invocations, |mut b, invocation| {
            b.push_bind(invocation.id)
                .push_bind(invocation.parent)
                .push_bind(invocation.predecessor)
                .push_bind(invocation.run_id)
                .push_bind(invocation.function_name)
                .push_bind(invocation.input)
                .push_bind(invocation.params)
                .push_bind(invocation.output)
                .push_bind(invocation.start_time)
                .push_bind(invocation.end_time);
        });

        query_builder
            .push(" ON CONFLICT (id) DO NOTHING")
            .build()
            .execute(&self.pool)
            .await
            .context("error inserting invocations")?;

        Ok(())
    }

    async fn finalize_run(
        &self,
        success: bool,
        run_id: RunId,
        output: &Value,
        end_time: DateTime<Utc>,
    ) -> Result<()> {
        let result = sqlx::query(
            "update runs set end_time = $1, success = $2, output = $3 where id = $4 and success is null and end_time is null",
        )
            .bind(end_time)
            .bind(success)
            .bind(output)
            .bind(run_id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            debug!(
                run = %run_id,
                "Run already finalized; skipping update"
            );
        }

        Ok(())
    }
}
