use florca_core::deployment::DeploymentName;
use std::path::PathBuf;

/// An error whose message is safe to surface directly to the CLI user.
#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct UserFacingError(pub String);

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct ListDeploymentsError(#[from] pub anyhow::Error);

#[derive(Debug, thiserror::Error)]
pub enum DeployError {
    #[error("Invalid function config")]
    InvalidFunctionConfig(toml::de::Error, PathBuf),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum FetchDeploymentError {
    #[error("Deployment {0} not found")]
    NotFound(DeploymentName),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum DeleteDeploymentError {
    #[error("Deployment {0} not found")]
    NotFound(DeploymentName),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}
