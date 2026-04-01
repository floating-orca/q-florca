use crate::{AppState, error::MessageError};
use axum::Json;
use axum::extract::{Path, State};
use axum::response::{Html, IntoResponse, Response};
use florca_core::invocation::InvocationId;
use florca_core::run::RunId;
use reqwest::StatusCode;
use serde_json::Value;
use std::sync::Arc;
use tracing::error;

pub async fn to_workflow(
    Path(workflow_run): Path<RunId>,
    State(state): State<Arc<AppState>>,
    Json(message): Json<Value>,
) -> axum::response::Result<Json<Value>, MessageError> {
    let value = state
        .message_service
        .send_message_to_workflow(workflow_run, message)
        .await?;
    Ok(value.into())
}

pub async fn to_function(
    Path((workflow_run, function_invocation_id)): Path<(RunId, InvocationId)>,
    State(state): State<Arc<AppState>>,
    Json(message): Json<Value>,
) -> axum::response::Result<Json<Value>, MessageError> {
    let value = state
        .message_service
        .send_message_to_function(workflow_run, function_invocation_id, message)
        .await?;
    Ok(value.into())
}

pub async fn html_from_workflow(
    Path(workflow_run): Path<RunId>,
    State(state): State<Arc<AppState>>,
) -> axum::response::Result<Html<String>, MessageError> {
    let value = state
        .message_service
        .fetch_html_from_workflow(workflow_run)
        .await?;
    Ok(value.into())
}

pub async fn html_from_function(
    Path((workflow_run, function_invocation_id)): Path<(RunId, InvocationId)>,
    State(state): State<Arc<AppState>>,
) -> axum::response::Result<Html<String>, MessageError> {
    let value = state
        .message_service
        .fetch_html_from_function(workflow_run, function_invocation_id)
        .await?;
    Ok(value.into())
}

impl IntoResponse for MessageError {
    fn into_response(self) -> Response {
        match &self {
            MessageError::Other(err) => {
                error!("{:?}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}
