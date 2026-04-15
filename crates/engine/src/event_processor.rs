use std::sync::Arc;

use anyhow::Context;
use tracing::{debug, error, info, warn};

use crate::driver::driver_events::{DriverEvent, InvocationEvent, LogEvent, LogLevel};
use crate::repository::EngineRepository;
use florca_core::invocation::InvocationEntity;
use florca_core::run::RunId;
use serde_json::Value;

#[derive(Debug, Clone)]
pub struct EventProcessor {
    run_id: RunId,
    repository: Arc<dyn EngineRepository>,
}

impl EventProcessor {
    pub fn new(run_id: RunId, repository: Arc<dyn EngineRepository>) -> Self {
        Self { run_id, repository }
    }

    pub async fn process_events_batch(
        &self,
        parsed_events: Vec<DriverEvent>,
    ) -> anyhow::Result<()> {
        let invocation_events = self.collect_invocation_events_and_log(parsed_events);
        let invocations_to_insert = self.to_invocation_entities(invocation_events);

        if invocations_to_insert.is_empty() {
            return Ok(());
        }

        self.repository
            .insert_invocations(invocations_to_insert)
            .await
            .with_context(|| {
                format!("Failed to insert invocation events for run {}", self.run_id)
            })?;

        Ok(())
    }

    fn collect_invocation_events_and_log(
        &self,
        parsed_events: Vec<DriverEvent>,
    ) -> Vec<InvocationEvent> {
        let mut invocation_events = Vec::new();

        for driver_event in parsed_events {
            match driver_event {
                DriverEvent::Invocation(invocation_event) => {
                    invocation_events.push(invocation_event);
                }
                DriverEvent::Log(log_event) => self.log_driver_event(log_event),
            }
        }

        invocation_events
    }

    fn log_driver_event(&self, log_event: LogEvent) {
        match log_event {
            LogEvent::Workflow(log) => {
                log_with_level(
                    log.level,
                    self.run_id,
                    None,
                    None,
                    &log.message,
                    log.data.as_ref(),
                );
            }
            LogEvent::Invocation(log) => {
                log_with_level(
                    log.level,
                    self.run_id,
                    Some(log.invocation_id.to_string()),
                    Some(log.function_name.to_string()),
                    &log.message,
                    log.data.as_ref(),
                );
            }
        }
    }

    fn to_invocation_entities(
        &self,
        invocation_events: Vec<InvocationEvent>,
    ) -> Vec<InvocationEntity> {
        invocation_events
            .into_iter()
            .map(|invocation_event| match invocation_event {
                InvocationEvent::InvocationSuccess(event) => {
                    debug!(run = %self.run_id, invocation = %event.id, "Processing invocation success");
                    InvocationEntity {
                        id: event.id,
                        parent: event.parent,
                        predecessor: event.predecessor,
                        run_id: self.run_id,
                        function_name: event.function_name,
                        input: event.input,
                        params: event.params,
                        output: Some(event.output),
                        start_time: event.start_time,
                        end_time: Some(event.end_time),
                    }
                }
                InvocationEvent::InvocationFailure(event) => {
                    debug!(run = %self.run_id, invocation = %event.id, "Processing invocation failure");
                    InvocationEntity {
                        id: event.id,
                        parent: event.parent,
                        predecessor: event.predecessor,
                        run_id: self.run_id,
                        function_name: event.function_name,
                        input: event.input,
                        params: event.params,
                        output: event.error,
                        start_time: event.start_time,
                        end_time: None,
                    }
                }
            })
            .collect()
    }
}

fn log_with_level(
    level: LogLevel,
    run_id: RunId,
    invocation: Option<String>,
    function: Option<String>,
    message: &str,
    data: Option<&Value>,
) {
    let data = data
        .and_then(|d| serde_json::to_string(&d).ok())
        .map(|s| format!(" {s}"))
        .unwrap_or_default();
    let full_message = format!("{message}{data}");

    match level {
        LogLevel::Debug => {
            if let (Some(invocation), Some(function)) = (invocation, function) {
                debug!(target: "driver", run = %run_id, invocation, function, "{}", full_message);
            } else {
                debug!(target: "driver", run = %run_id, "{}", full_message);
            }
        }
        LogLevel::Info => {
            if let (Some(invocation), Some(function)) = (invocation, function) {
                info!(target: "driver", run = %run_id, invocation, function, "{}", full_message);
            } else {
                info!(target: "driver", run = %run_id, "{}", full_message);
            }
        }
        LogLevel::Warn => {
            if let (Some(invocation), Some(function)) = (invocation, function) {
                warn!(target: "driver", run = %run_id, invocation, function, "{}", full_message);
            } else {
                warn!(target: "driver", run = %run_id, "{}", full_message);
            }
        }
        LogLevel::Error => {
            if let (Some(invocation), Some(function)) = (invocation, function) {
                error!(target: "driver", run = %run_id, invocation, function, "{}", full_message);
            } else {
                error!(target: "driver", run = %run_id, "{}", full_message);
            }
        }
    }
}
