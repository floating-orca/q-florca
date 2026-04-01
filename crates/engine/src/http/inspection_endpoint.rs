use crate::{AppState, error::GetInspectionError};
use axum::Json;
use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use florca_core::inspection::Inspection;
use florca_core::run::LatestOrRunId;
use reqwest::StatusCode;
use std::sync::Arc;
use tracing::error;

pub async fn get_inspection(
    Path(latest_or_run_id): Path<LatestOrRunId>,
    State(state): State<Arc<AppState>>,
) -> axum::response::Result<Json<Inspection>, GetInspectionError> {
    let inspection = state
        .inspection_service
        .get_inspection(latest_or_run_id)
        .await?;
    Ok(Json(inspection))
}

impl IntoResponse for GetInspectionError {
    fn into_response(self) -> Response {
        match &self {
            GetInspectionError::NoLatest => {
                (StatusCode::BAD_REQUEST, self.to_string()).into_response()
            }
            GetInspectionError::NotFound(_run_id) => {
                (StatusCode::NOT_FOUND, self.to_string()).into_response()
            }
            GetInspectionError::Other(err) => {
                error!("{:?}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}
