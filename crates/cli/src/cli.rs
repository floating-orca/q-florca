use crate::command::{
    CompletionsCommand, DeleteCommand, DeployCommand, InfoCommand, InspectCommand, InvokeCommand,
    KillCommand, ListCommand, MessageCommand, NewCommand, PsCommand, TemplatesCommand,
};
use crate::util;
use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "qflorca", version, about = "A command-line interface for qFLORCA (queue-native FLORCA)", long_about = None)]
pub struct Cli {
    #[command(flatten)]
    pub global_opts: GlobalOpts,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Args)]
pub struct GlobalOpts {
    /// An optional .env file to load in addition to .env and .env.local
    #[arg(long, value_parser = util::validate_path_exists)]
    pub env_file: Option<PathBuf>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Generate shell completions
    Completions(CompletionsCommand),
    /// Delete a deployment
    Delete(DeleteCommand),
    /// Deploy a workflow
    Deploy(DeployCommand),
    /// Get information about the CLI
    Info(InfoCommand),
    /// Inspect a workflow run
    Inspect(InspectCommand),
    /// Invoke an AWS deployment and stream events
    Invoke(InvokeCommand),
    /// Kill a workflow run
    Kill(KillCommand),
    /// List deployments
    List(ListCommand),
    /// Interact with workflow message handlers
    Message(MessageCommand),
    /// Create a new function
    New(NewCommand),
    /// List running workflows
    Ps(PsCommand),
/// List available templates
    Templates(TemplatesCommand),
}
