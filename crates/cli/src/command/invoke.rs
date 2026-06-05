use crate::util;
use anyhow::{Context, Result};
use aws_config::BehaviorVersion;
use aws_sdk_sqs::Client as SqsClient;
use clap::Args;
use florca_core::deployment::DeploymentName;
use florca_core::function::FunctionName;
use florca_core::http::{DeployerUrl, RequestBuilderExt};
use florca_core::lookup::LookupManifest;
use serde_json::Value;
use std::time::Instant;
use uuid::Uuid;

/// Consecutive empty receives that signal the events queue is drained for this run.
const DRAIN_EMPTY_POLLS: u32 = 5;
/// How long to push other-run leftover events out of the receive pool (seconds).
/// Must comfortably exceed a single drain's duration so they don't reappear mid-drain.
const FOREIGN_HIDE_SECS: i32 = 120;

#[derive(Debug, Args)]
pub struct InvokeCommand {
    /// The name of the deployment to invoke
    #[arg(short, long)]
    pub deployment_name: DeploymentName,

    /// The input to the entry function (JSON)
    #[arg(short, long, value_parser = util::parse_json)]
    pub input: Option<Value>,

    /// The entry-point function name
    #[arg(short, long, default_value = "start")]
    pub entry_point: FunctionName,
}

impl InvokeCommand {
    /// # Errors
    ///
    /// Returns an error if the deployment is not found, the SQS send fails,
    /// or a `run_failed` event is received.
    pub fn execute(self) -> Result<()> {
        tokio::runtime::Runtime::new()?.block_on(self.run())
    }

    async fn run(self) -> Result<()> {
        // Fetch the lookup manifest from the deployer.
        let manifest_url = DeployerUrl::path(&[self.deployment_name.as_ref(), "manifest"]);
        let manifest: LookupManifest = reqwest::Client::new()
            .get(manifest_url.as_str())
            .with_basic_auth_from_env()
            .send()
            .await
            .context("Failed to reach deployer")?
            .error_for_status()
            .context("Deployer returned error for manifest request")?
            .json()
            .await
            .context("Failed to parse manifest")?;

        // Find the entry-point function.
        let entry = manifest
            .entries
            .iter()
            .find(|e| e.name == self.entry_point)
            .with_context(|| {
                format!(
                    "Entry-point function \"{}\" not found in deployment \"{}\"",
                    self.entry_point, self.deployment_name
                )
            })?;

        let invoke_queue_url = entry
            .invoke_queue_url
            .as_deref()
            .with_context(|| {
                format!(
                    "Function \"{}\" has no invoke queue URL — is it an AWS function?",
                    self.entry_point
                )
            })?;

        let sdk_config = aws_config::defaults(BehaviorVersion::v2026_01_12())
            .load()
            .await;
        let sqs = SqsClient::new(&sdk_config);

        let run_id = Uuid::new_v4().to_string();
        let invocation_id = Uuid::new_v4().to_string();

        let envelope = serde_json::json!({
            "runId": run_id,
            "invocationId": invocation_id,
            "parentId": null,
            "predecessorId": null,
            "fn": self.entry_point.to_string(),
            "payload": self.input.unwrap_or(Value::Null),
            "continuationState": null,
            "returnTo": null,
            "fanOutId": null,
            "fanOutTotal": null,
            "eventsQueueUrl": manifest.events_queue_url,
        });

        let started = Instant::now();
        sqs.send_message()
            .queue_url(invoke_queue_url)
            .message_body(serde_json::to_string(&envelope)?)
            .send()
            .await
            .context("Failed to send invocation message to SQS")?;

        println!("Run: {run_id}");
        println!("Polling events…");

        // Long-poll the events queue until run_completed or run_failed.
        let mut failed = false;
        loop {
            let resp = sqs
                .receive_message()
                .queue_url(&manifest.events_queue_url)
                .max_number_of_messages(10)
                .wait_time_seconds(20)
                .send()
                .await
                .context("Failed to poll events queue")?;

            for msg in resp.messages() {
                let body = msg.body().unwrap_or("");
                let event: Value = match serde_json::from_str(body) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                // Filter by runId. The events queue is shared across every run of
                // a deployment, so it can also hold leftover events from other
                // runs. Push those aside (extend their visibility) so they leave
                // the receive pool instead of crowding out this run's events.
                if event.get("runId").and_then(Value::as_str) != Some(&run_id) {
                    if let Some(handle) = msg.receipt_handle() {
                        let _ = sqs
                            .change_message_visibility()
                            .queue_url(&manifest.events_queue_url)
                            .receipt_handle(handle)
                            .visibility_timeout(FOREIGN_HIDE_SECS)
                            .send()
                            .await;
                    }
                    continue;
                }

                let event_type = event.get("type").and_then(Value::as_str).unwrap_or("?");
                println!("{}", serde_json::to_string_pretty(&event).unwrap_or_default());

                // Delete processed message.
                if let Some(handle) = msg.receipt_handle() {
                    let _ = sqs
                        .delete_message()
                        .queue_url(&manifest.events_queue_url)
                        .receipt_handle(handle)
                        .send()
                        .await;
                }

                if event_type == "run_completed" || event_type == "run_failed" {
                    if event_type == "run_failed" {
                        failed = true;
                    }
                    // Drain remaining events for THIS run. run_completed can arrive
                    // (SQS is unordered) while many function_invoked/completed events
                    // are still queued — especially for bursty fan-out workloads that
                    // emit hundreds of events at once. We keep polling until a streak
                    // of genuinely-empty receives. This-run messages are printed and
                    // deleted; other-run leftovers are pushed aside (visibility
                    // extended) so they leave the pool rather than being mistaken for
                    // a drained queue, which previously caused an early exit that
                    // silently dropped this run's events.
                    let mut empty_streak = 0;
                    while empty_streak < DRAIN_EMPTY_POLLS {
                        let drain = sqs
                            .receive_message()
                            .queue_url(&manifest.events_queue_url)
                            .max_number_of_messages(10)
                            .wait_time_seconds(2)
                            .send()
                            .await
                            .context("Failed to poll events queue during drain")?;
                        let dmsgs = drain.messages();
                        if dmsgs.is_empty() {
                            empty_streak += 1;
                            continue;
                        }
                        // Any received batch (ours or leftover) is progress: reset
                        // the streak. Only truly-empty receives count toward exit.
                        empty_streak = 0;
                        for dmsg in dmsgs {
                            let dbody = dmsg.body().unwrap_or("");
                            let devent: Value = match serde_json::from_str(dbody) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            let handle = dmsg.receipt_handle();
                            if devent.get("runId").and_then(Value::as_str) != Some(&run_id) {
                                if let Some(h) = handle {
                                    let _ = sqs
                                        .change_message_visibility()
                                        .queue_url(&manifest.events_queue_url)
                                        .receipt_handle(h)
                                        .visibility_timeout(FOREIGN_HIDE_SECS)
                                        .send()
                                        .await;
                                }
                                continue;
                            }
                            println!("{}", serde_json::to_string_pretty(&devent).unwrap_or_default());
                            if let Some(h) = handle {
                                let _ = sqs
                                    .delete_message()
                                    .queue_url(&manifest.events_queue_url)
                                    .receipt_handle(h)
                                    .send()
                                    .await;
                            }
                        }
                    }
                    println!("Elapsed: {:.2}s", started.elapsed().as_secs_f64());
                    if failed {
                        anyhow::bail!("Run failed");
                    }
                    return Ok(());
                }
            }

            if failed {
                anyhow::bail!("Run failed");
            }
        }
    }
}
