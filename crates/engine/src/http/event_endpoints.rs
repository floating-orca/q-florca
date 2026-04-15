use crate::{AppState, driver::driver_events::DriverEvent, error::DriverEventError};
use axum::Json;
use axum::extract::{Path, State};
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
};
use florca_core::run::RunId;
use std::sync::Arc;
use tracing::{debug, error};

pub async fn handle_events_batch(
    Path(run_id): Path<RunId>,
    State(state): State<Arc<AppState>>,
    Json(events): Json<Vec<DriverEvent>>,
) -> axum::response::Result<(), DriverEventError> {
    debug!(run = %run_id, "Received event batch with {} events", events.len());

    let run_exists = state
        .run_service
        .run_exists(run_id)
        .await
        .map_err(DriverEventError::Other)?;
    if !run_exists {
        return Err(DriverEventError::NotFound(run_id));
    }

    if events.is_empty() {
        return Ok(());
    }

    let processor = state.run_service.new_event_processor(run_id);
    processor
        .process_events_batch(events)
        .await
        .map_err(DriverEventError::Other)?;

    Ok(())
}

impl IntoResponse for DriverEventError {
    fn into_response(self) -> Response {
        match self {
            DriverEventError::NotFound(_) => {
                (StatusCode::NOT_FOUND, self.to_string()).into_response()
            }
            DriverEventError::Other(err) => {
                error!("Driver event error: {}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}
