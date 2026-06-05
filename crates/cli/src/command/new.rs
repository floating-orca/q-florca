use crate::util;
use anyhow::{Result, bail};
use clap::{Args, Subcommand};
use florca_core::function::{AwsFunctionConfig, FunctionConfig, KnFunctionConfig};
use florca_core::provider::Provider;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Args)]
pub struct NewCommand {
    /// The path to the workflow directory to create the function in
    #[arg(short, long)]
    pub workflow_directory: PathBuf,

    #[command(subcommand)]
    pub subcommand: NewSubcommand,
}

#[derive(Debug, Subcommand)]
pub enum NewSubcommand {
    /// Create a new function
    Function(NewFunctionSubcommand),
    /// Create a new plugin
    Plugin(NewPluginSubcommand),
}

#[derive(Debug, Args)]
pub struct NewFunctionSubcommand {
    /// The name of the function to create
    #[arg(value_parser = util::validate_name)]
    pub name: String,

    /// The provider to use for the function
    #[arg(short, long)]
    pub provider: Provider,

    /// The runtime to use for the function.
    /// See the `templates` command for runtimes with templates.
    #[arg(short, long)]
    pub runtime: String,

    #[arg(short, long)]
    pub arbitrary: bool,
}

#[derive(Debug, Args)]
pub struct NewPluginSubcommand {
    /// The name of the plugin to create
    #[arg(value_parser = util::validate_name)]
    pub name: String,
}

impl NewCommand {
    /// # Errors
    ///
    /// This function will return an error if the function or plugin already exists or if writing to the file system fails.
    pub fn execute(self) -> Result<()> {
        match &self.subcommand {
            NewSubcommand::Function(new_function_args) => {
                create_function(new_function_args, &self.workflow_directory)?;
            }
            NewSubcommand::Plugin(new_plugin_args) => {
                create_plugin(new_plugin_args, &self.workflow_directory)?;
            }
        }
        Ok(())
    }
}

fn create_function(
    new_function_args: &NewFunctionSubcommand,
    workflow_directory: &Path,
) -> Result<()> {
    let NewFunctionSubcommand {
        name,
        provider,
        runtime,
        arbitrary,
    } = &new_function_args;

    let function_path = workflow_directory.join(name);
    if function_path.exists() {
        bail!("Function {name} already exists");
    }

    let template_files = util::template::get_function_template(*provider, runtime);
    if template_files.is_none() && !arbitrary {
        bail!(
            "No template found for provider '{}' and runtime '{}'. Run `qflorca templates` to see all available templates. If you still want to create a function with this provider and runtime, use the `--arbitrary` flag.",
            provider.code(),
            runtime
        );
    }
    let provider_path = function_path.join(provider.code());
    fs::create_dir_all(&provider_path)?;
    if let Some(template_files) = template_files {
        for template_file in template_files {
            let file_path = provider_path.join(template_file.relative_file_path);
            fs::write(file_path, template_file.bytes)?;
        }
    }
    create_function_toml(*provider, runtime, &function_path)?;

    Ok(())
}

fn create_function_toml(provider: Provider, runtime: &str, function_path: &Path) -> Result<()> {
    let function_toml_path = function_path.join("function.toml");
    let config = match provider {
        Provider::Aws => FunctionConfig::Aws(AwsFunctionConfig {
            runtime: runtime.to_string(),
            handler: "index.handler".to_string(),
            memory: 128,
            timeout: 3,
        }),
        Provider::Kn => FunctionConfig::Kn(KnFunctionConfig {
            runtime: runtime.to_string(),
        }),
    };
    fs::write(function_toml_path, toml::to_string_pretty(&config)?)?;
    Ok(())
}

fn create_plugin(new_plugin_args: &NewPluginSubcommand, workflow_directory: &Path) -> Result<()> {
    let name = &new_plugin_args.name;

    let function_path = workflow_directory.join(name).with_extension("ts");
    if function_path.exists() {
        bail!("Function {name} already exists");
    }

    fs::create_dir_all(workflow_directory)?;
    fs::write(function_path, util::template::get_plugin_template())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_plugin() {
        let dir = tempfile::tempdir().unwrap();
        let workflow_directory = dir.path().to_path_buf();
        let new_plugin_args = NewPluginSubcommand {
            name: "test_plugin".to_string(),
        };
        let command = NewCommand {
            workflow_directory: workflow_directory.clone(),
            subcommand: NewSubcommand::Plugin(new_plugin_args),
        };
        command.execute().unwrap();
        assert!(workflow_directory.join("test_plugin.ts").exists());
    }

    #[test]
    fn test_create_function() {
        let dir = tempfile::tempdir().unwrap();
        let workflow_directory = dir.path().to_path_buf();
        let new_function_args = NewFunctionSubcommand {
            name: "test_function".to_string(),
            provider: Provider::Aws,
            runtime: "nodejs24.x".to_string(),
            arbitrary: false,
        };
        let command = NewCommand {
            workflow_directory: workflow_directory.clone(),
            subcommand: NewSubcommand::Function(new_function_args),
        };
        command.execute().unwrap();

        // Verify that the template files were copied over

        assert!(
            workflow_directory
                .join("test_function")
                .join("aws")
                .join("index.js")
                .exists()
        );

        // Verify that the function.toml file was created with the correct content

        assert!(
            workflow_directory
                .join("test_function")
                .join("function.toml")
                .exists()
        );
        let actual_function_toml_content = fs::read_to_string(
            workflow_directory
                .join("test_function")
                .join("function.toml"),
        )
        .unwrap();
        let expected_function_toml_content =
            toml::to_string_pretty(&FunctionConfig::Aws(AwsFunctionConfig {
                runtime: "nodejs24.x".to_string(),
                handler: "index.handler".to_string(),
                memory: 128,
                timeout: 3,
            }))
            .unwrap();
        assert_eq!(actual_function_toml_content, expected_function_toml_content);
    }
}
