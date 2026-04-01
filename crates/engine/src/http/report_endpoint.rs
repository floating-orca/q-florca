use crate::{AppState, error::ReportError};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use florca_core::driver::ReportReadinessRequest;
use std::sync::Arc;
use tracing::error;

pub async fn report_readiness(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<ReportReadinessRequest>,
) -> axum::response::Result<(), ReportError> {
    state
        .run_service
        .report_readiness(payload.run_id, payload.port)
        .await?;
    Ok(())
}

impl IntoResponse for ReportError {
    fn into_response(self) -> Response {
        match &self {
            ReportError::NotFound(_run_id) => {
                (StatusCode::NOT_FOUND, self.to_string()).into_response()
            }
            ReportError::Other(err) => {
                error!("{:?}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}
