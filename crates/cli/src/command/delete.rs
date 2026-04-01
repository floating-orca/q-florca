use std::time::Duration;

use anyhow::Result;
use clap::Args;
use florca_core::{http::DeployerUrl, http::RequestBuilderExt};
use reqwest::blocking::Client;

#[derive(Debug, Args)]
pub struct DeleteCommand {
    /// The name of the deployment to delete
    pub deployment_name: String,
}

impl DeleteCommand {
    /// # Errors
    ///
    /// This function will return an error if the request to the server fails, the server returns an error, or the response cannot be parsed.
    pub fn execute(self) -> Result<()> {
        let url = DeployerUrl::path(&[&self.deployment_name]);
        let response = Client::builder()
            .timeout(Duration::from_hours(1))
            .build()?
            .delete(url)
            .with_basic_auth_from_env()
            .send()?;
        if let Err(e) = response.error_for_status_ref() {
            let text = response.text()?;
            if text.is_empty() {
                anyhow::bail!(e);
            }
            anyhow::bail!(text);
        }
        println!("Deployment deleted");
        Ok(())
    }
}
