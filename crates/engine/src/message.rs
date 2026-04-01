use std::sync::Arc;

use crate::error::MessageError;
use crate::process::ProcessManager;
use anyhow::Context;
use florca_core::http::RequestBuilderExt;
use florca_core::invocation::InvocationId;
use florca_core::run::RunId;
use reqwest::Client;
use serde_json::Value;

#[derive(Debug)]
pub struct MessageService {
    process_manager: Arc<ProcessManager>,
    http_client: Client,
}

impl MessageService {
    pub fn new(process_manager: Arc<ProcessManager>) -> Self {
        Self {
            process_manager,
            http_client: Client::new(),
        }
    }

    pub async fn send_message_to_workflow(
        &self,
        run_id: RunId,
        message: Value,
    ) -> Result<Value, MessageError> {
        self.send_message(run_id, None, message).await
    }

    pub async fn send_message_to_function(
        &self,
        run_id: RunId,
        invocation_id: InvocationId,
        message: Value,
    ) -> Result<Value, MessageError> {
        self.send_message(run_id, Some(invocation_id), message)
            .await
    }

    async fn send_message(
        &self,
        run_id: RunId,
        invocation_id: Option<InvocationId>,
        message: Value,
    ) -> Result<Value, MessageError> {
        let port = self
            .process_manager
            .get_port_for_run(run_id)
            .await
            .context("No driver process found for run")?;
        let url = if let Some(invocation_id) = invocation_id {
            format!("http://localhost:{}/{}", &port, invocation_id)
        } else {
            format!("http://localhost:{}/", &port)
        };
        let response = self
            .http_client
            .post(url)
            .with_basic_auth_from_env()
            .json(&message)
            .send()
            .await
            .context("Failed to send request")?;
        if response.content_length() == Some(0) {
            return Ok(Value::Null);
        }
        let value = response
            .json::<Value>()
            .await
            .context("Failed to parse response")?;
        Ok(value)
    }

    pub async fn fetch_html_from_workflow(&self, run_id: RunId) -> Result<String, MessageError> {
        self.fetch_html(run_id, None).await
    }

    pub async fn fetch_html_from_function(
        &self,
        run_id: RunId,
        invocation_id: InvocationId,
    ) -> Result<String, MessageError> {
        self.fetch_html(run_id, Some(invocation_id)).await
    }

    pub async fn fetch_html(
        &self,
        run_id: RunId,
        invocation_id: Option<InvocationId>,
    ) -> Result<String, MessageError> {
        let port = self
            .process_manager
            .get_port_for_run(run_id)
            .await
            .context("No driver process found for run")?;
        let url = if let Some(invocation_id) = invocation_id {
            format!("http://localhost:{}/{}", &port, invocation_id)
        } else {
            format!("http://localhost:{}/", &port)
        };
        let response = self
            .http_client
            .get(url)
            .with_basic_auth_from_env()
            .send()
            .await
            .context("Failed to send request")?;
        if response.content_length() == Some(0) {
            return Ok(String::new());
        }
        let html = response.text().await.context("Failed to parse response")?;
        Ok(html)
    }
}
