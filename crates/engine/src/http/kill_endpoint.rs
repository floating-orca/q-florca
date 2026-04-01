use crate::{AppState, error::KillError};
use axum::Json;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use florca_core::run::{AllOrRunId, RunId};
use reqwest::StatusCode;
use std::sync::Arc;
use tracing::error;

pub async fn kill(
    Path(all_or_run_id): Path<AllOrRunId>,
    State(state): State<Arc<AppState>>,
) -> axum::response::Result<Json<Vec<RunId>>, KillError> {
    let killed = state.kill_service.kill_runs(all_or_run_id).await?;
    Ok(Json(killed))
}

impl IntoResponse for KillError {
    fn into_response(self) -> Response {
        match &self {
            KillError::NotFound(_run_id) => {
                (StatusCode::NOT_FOUND, self.to_string()).into_response()
            }
            KillError::Other(err) => {
                error!("{:?}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}
