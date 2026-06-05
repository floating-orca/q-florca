use anyhow::Result;
use cli::{Cli, Command};

pub mod cli;
pub mod command;
pub mod util;

/// The main entry point for the CLI application.
///
/// # Errors
///
/// This function will return an error if the command line arguments cannot be parsed or if the command execution fails.
pub fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Completions(command) => command.execute(),
        Command::Delete(command) => command.execute()?,
        Command::Deploy(command) => command.execute()?,
        Command::Info(command) => command.execute(),
        Command::Inspect(command) => command.execute()?,
        Command::Invoke(command) => command.execute()?,
        Command::Kill(command) => command.execute()?,
        Command::List(command) => command.execute()?,
        Command::Message(subcmd) => subcmd.execute()?,
        Command::New(command) => command.execute()?,
        Command::Ps(command) => command.execute()?,
Command::Templates(command) => command.execute(),
    }
    Ok(())
}
