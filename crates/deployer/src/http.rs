use crate::AppState;
use crate::errors::{
    DeleteDeploymentError, DeployError, FetchDeploymentError, ListDeploymentsError,
};
use anyhow::Result;
use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Multipart};
use axum::response::{IntoResponse, Response};
use axum::{
    Json, Router,
    extract::{Path, State},
    routing::get,
};
use florca_core::deployment::DeploymentName;
use reqwest::StatusCode;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio_util::io::ReaderStream;
use tracing::{error, warn};

pub async fn serve(shared_state: Arc<RwLock<AppState>>) -> Result<()> {
    let app = Router::new()
        .route("/", get(list_deployments).post(deploy))
        .route("/{name}", get(fetch_deployment).delete(delete_deployment))
        .with_state(shared_state)
        .layer(DefaultBodyLimit::disable());
    let port = std::env::var("PORT").unwrap_or_else(|_| "8000".to_string());
    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

pub async fn list_deployments(
    State(state): State<Arc<RwLock<AppState>>>,
) -> axum::response::Result<Json<Vec<DeploymentName>>, ListDeploymentsError> {
    let deployments = state
        .read()
        .await
        .deployer_service
        .list_deployments()
        .await?;
    Ok(Json(deployments))
}

pub async fn deploy(
    State(state): State<Arc<RwLock<AppState>>>,
    multipart: Multipart,
) -> axum::response::Result<(), DeployError> {
    async fn extract_bytes_and_name(
        mut multipart: Multipart,
    ) -> Result<(Vec<u8>, DeploymentName, bool)> {
        let mut bytes: Option<Vec<u8>> = None;
        let mut deployment_name: Option<DeploymentName> = None;
        let mut force: bool = false;
        while let Some(field) = multipart.next_field().await? {
            let field_name = field.name().unwrap().to_string();
            if field_name == "file" {
                bytes = Some(field.bytes().await?.to_vec());
            } else if field_name == "name" {
                deployment_name = Some(DeploymentName::from(field.text().await?));
            } else if field_name == "force" {
                force = field.text().await? == "true";
            }
        }
        let bytes = bytes.ok_or_else(|| {
            DeployError::Other(anyhow::anyhow!("Missing file field in multipart"))
        })?;
        let deployment_name = deployment_name.ok_or_else(|| {
            DeployError::Other(anyhow::anyhow!("Missing name field in multipart"))
        })?;
        Ok((bytes, deployment_name, force))
    }
    let (bytes, deployment_name, force) = extract_bytes_and_name(multipart).await?;
    state
        .write()
        .await
        .deployer_service
        .deploy(&deployment_name, &bytes, force)
        .await
}

pub async fn fetch_deployment(
    Path(name): Path<DeploymentName>,
    State(state): State<Arc<RwLock<AppState>>>,
) -> axum::response::Result<Body> {
    let file = state
        .read()
        .await
        .deployer_service
        .fetch_deployment(&name)
        .await?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);
    Ok(body)
}

pub async fn delete_deployment(
    Path(name): Path<String>,
    State(state): State<Arc<RwLock<AppState>>>,
) -> axum::response::Result<(), DeleteDeploymentError> {
    state
        .write()
        .await
        .deployer_service
        .delete_deployment(&name.into())
        .await
}

impl IntoResponse for ListDeploymentsError {
    fn into_response(self) -> Response {
        error!("{:?}", self.0);
        (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
    }
}

impl IntoResponse for DeployError {
    fn into_response(self) -> Response {
        match &self {
            DeployError::InvalidFunctionConfig(err, function_toml_path) => {
                let last_two_components = last_two_components(function_toml_path);
                warn!("{}: {:?}", function_toml_path.to_str().unwrap(), err);
                (
                    StatusCode::BAD_REQUEST,
                    format!("{}: {}", last_two_components.to_str().unwrap(), err),
                )
                    .into_response()
            }
            DeployError::Io(err) => {
                error!("{:?}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
            DeployError::Other(e) => {
                error!("{:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}

impl IntoResponse for FetchDeploymentError {
    fn into_response(self) -> Response {
        match &self {
            FetchDeploymentError::NotFound(_) => {
                (StatusCode::NOT_FOUND, self.to_string()).into_response()
            }
            FetchDeploymentError::Other(err) => {
                error!("{:?}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}

impl IntoResponse for DeleteDeploymentError {
    fn into_response(self) -> Response {
        match &self {
            DeleteDeploymentError::NotFound(_) => {
                (StatusCode::NOT_FOUND, self.to_string()).into_response()
            }
            DeleteDeploymentError::Other(err) => {
                error!("{:?}", err);
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error").into_response()
            }
        }
    }
}

fn last_two_components(function_toml_path: &std::path::Path) -> PathBuf {
    function_toml_path
        .components()
        .rev()
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<PathBuf>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_last_two_components() {
        let path = PathBuf::from("/path/to/some/workflow/function.toml");
        let result = last_two_components(&path);
        assert_eq!(result, PathBuf::from("workflow/function.toml"));
    }
}
