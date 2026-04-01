use crate::process::ProcessManager;
use crate::repository::EngineRepository;
use anyhow::Result;
use florca_core::ps::RunningWorkflow;
use std::{fmt::Debug, sync::Arc};

#[derive(Debug, Clone)]
pub struct PsService {
    repository: Arc<dyn EngineRepository>,
    process_manager: Arc<ProcessManager>,
}

impl PsService {
    pub fn new(
        repository: Arc<dyn EngineRepository>,
        process_manager: Arc<ProcessManager>,
    ) -> Self {
        PsService {
            repository,
            process_manager,
        }
    }
}

impl PsService {
    pub async fn get_running_workflows(&self) -> Result<Vec<RunningWorkflow>> {
        let runs = self.repository.get_runs_without_end_time().await?;
        let driver_processes = self.process_manager.driver_processes().read().await;
        let running_workflows = runs
            .into_iter()
            .filter(|run| driver_processes.contains_key(&run.id))
            .map(|run| RunningWorkflow {
                run_id: run.id,
                name: run.deployment_name,
            })
            .collect::<Vec<_>>();
        Ok(running_workflows)
    }
}
