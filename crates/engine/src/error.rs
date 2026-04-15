use florca_core::{function::FunctionName, run::RunId};

#[derive(Debug, thiserror::Error)]
pub enum GetInspectionError {
    #[error("No latest run")]
    NoLatest,
    #[error("Run {0} not found")]
    NotFound(RunId),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
pub enum RunWorkflowError {
    #[error("Deployment {0} not found")]
    DeploymentNotFound(String),
    #[error("Entry point not found: {0}")]
    EntryPointNotFound(FunctionName),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct PsError(#[from] pub anyhow::Error);

#[derive(Debug, thiserror::Error)]
pub enum KillError {
    #[error("Run {0} not found")]
    NotFound(RunId),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(thiserror::Error, Debug)]
pub enum MessageError {
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(thiserror::Error, Debug)]
pub enum WorkflowCompletionError {
    #[error("Run {0} not found")]
    NotFound(RunId),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(thiserror::Error, Debug)]
pub enum DriverEventError {
    #[error("Run {0} not found")]
    NotFound(RunId),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[derive(thiserror::Error, Debug)]
pub enum ReportError {
    #[error("Run {0} not found")]
    NotFound(RunId),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}
