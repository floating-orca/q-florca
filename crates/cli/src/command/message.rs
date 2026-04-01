use anyhow::Result;
use clap::Args;
use florca_core::http::{EngineUrl, RequestBuilderExt};
use florca_core::run::RunId;
use reqwest::blocking::Client;
use serde_json::Value;
use std::time::Duration;

use crate::util;

#[derive(Debug, Args)]
pub struct MessageCommand {
    /// The ID of the run to send the message to
    #[clap(short, long)]
    pub run_id: RunId,

    /// The message to send (JSON)
    #[clap(value_parser = util::parse_json)]
    pub message: Option<Value>,
}

impl MessageCommand {
    /// # Errors
    ///
    /// This function will return an error if the request to the engine fails, the engine returns an error, or the response cannot be parsed.
    pub fn execute(self) -> Result<()> {
        let url = EngineUrl::path(&[&self.run_id.to_string()]);
        let client = Client::builder().timeout(Duration::from_mins(1)).build()?;
        let response = client
            .post(url)
            .with_basic_auth_from_env()
            .json(&self.message)
            .send()?;
        if let Err(e) = response.error_for_status_ref() {
            let text = response.text()?;
            if text.is_empty() {
                anyhow::bail!(e);
            }
            anyhow::bail!(text);
        }
        let json: serde_json::Value = response.json()?;
        println!("{}", serde_json::to_string_pretty(&json)?);
        Ok(())
    }
}
