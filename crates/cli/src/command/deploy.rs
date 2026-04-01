use crate::util;
use anyhow::Result;
use clap::Args;
use florca_core::deployment::DeploymentName;
use florca_core::http::{DeployerUrl, RequestBuilderExt};
use ignore::WalkBuilder;
use reqwest::blocking::multipart::Form;
use reqwest::blocking::{Client, Response};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tempfile::{NamedTempFile, TempPath};
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

#[derive(Debug, Args)]
pub struct DeployCommand {
    /// The path to the workflow directory to deploy
    #[arg(short, long, value_parser = util::validate_path_exists)]
    pub workflow_directory: PathBuf,

    /// Force the redeployment of functions even if their code has not changed
    #[arg(short, long, default_value_t = false)]
    pub force: bool,

    /// The name of the deployment to create
    #[arg(value_parser = util::validate_name)]
    pub deployment_name: Option<String>,
}

impl DeployCommand {
    /// # Errors
    ///
    /// This function will return an error in the following cases:
    ///
    /// * The deployment name derived from the workflow directory is invalid.
    /// * The workflow directory cannot be zipped.
    /// * The request to the server fails, the server returns an error, or the response cannot be parsed.
    pub fn execute(self) -> Result<()> {
        let deployment_name = get_deployment_name(&self)?;
        let zip_path = zip_workflow(&self.workflow_directory)?;
        let form = build_form(&zip_path, &deployment_name.into(), self.force)?;
        let response = send(form)?;
        if let Err(e) = response.error_for_status_ref() {
            let text = response.text()?;
            if text.is_empty() {
                anyhow::bail!(e);
            }
            anyhow::bail!(text);
        }
        println!("Deployment successful");
        Ok(())
    }
}

fn get_deployment_name(deploy_args: &DeployCommand) -> Result<String> {
    if let Some(deployment_name) = &deploy_args.deployment_name {
        Ok(deployment_name.clone())
    } else {
        let name = deploy_args
            .workflow_directory
            .canonicalize()?
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        util::validate_name(&name)?;
        Ok(name)
    }
}

fn zip_workflow(workflow_path: impl AsRef<Path>) -> Result<TempPath> {
    let named_zip_file = NamedTempFile::with_suffix(".zip")?;
    let mut zip_writer = ZipWriter::new(named_zip_file.as_file());
    let prefix = workflow_path.as_ref().canonicalize()?;
    let walker = WalkBuilder::new(workflow_path)
        .standard_filters(false)
        .add_custom_ignore_filename(".florcaignore")
        .build();
    for entry in walker.filter_map(std::result::Result::ok) {
        let local_path = entry.path().canonicalize()?;
        if local_path.is_dir() {
            continue;
        }
        let zip_path = local_path.strip_prefix(&prefix)?;
        if zip_path.to_str().unwrap().is_empty() {
            continue;
        }
        if zip_path.to_str().unwrap() == ".florcaignore" {
            continue;
        }
        zip_writer.start_file_from_path(zip_path, SimpleFileOptions::default())?;
        let bytes = fs::read(&local_path)?;
        zip_writer.write_all(&bytes)?;
    }
    zip_writer.finish()?;
    let zip_path = named_zip_file.into_temp_path();
    Ok(zip_path)
}

fn build_form(zip_path: &Path, deployment_name: &DeploymentName, force: bool) -> Result<Form> {
    let form = Form::new()
        .file("file", zip_path)?
        .text("name", deployment_name.to_string())
        .text("force", force.to_string());
    Ok(form)
}

fn send(form: Form) -> Result<Response> {
    let url = DeployerUrl::base();
    let response = Client::builder()
        .timeout(Duration::from_hours(1))
        .build()?
        .post(url)
        .with_basic_auth_from_env()
        .multipart(form)
        .send()?;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use zip::ZipArchive;

    #[test]
    fn test_get_deployment_name() {
        let dir = tempfile::tempdir().unwrap();
        let subdir = dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        let deploy_args = DeployCommand {
            workflow_directory: subdir.clone(),
            deployment_name: None,
            force: false,
        };
        let name = get_deployment_name(&deploy_args).unwrap();
        assert_eq!(name, "subdir");
    }

    #[test]
    fn test_get_deployment_name_with_custom_name() {
        let dir = tempfile::tempdir().unwrap();
        let deploy_args = DeployCommand {
            workflow_directory: dir.path().to_path_buf(),
            deployment_name: Some("custom".to_string()),
            force: false,
        };
        let name = get_deployment_name(&deploy_args).unwrap();
        assert_eq!(name, "custom");
    }

    #[test]
    fn test_zip_workflow() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("test.txt"), "Hello, world!").unwrap();

        let zip_path = zip_workflow(dir.path()).unwrap();

        assert!(zip_path.exists());
        let mut zip_reader = ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        assert_eq!(zip_reader.len(), 1);
        let file = zip_reader.by_index(0).unwrap();
        assert_eq!(file.name(), "test.txt");
    }

    #[test]
    fn test_zip_with_subdirectory() {
        let dir = tempfile::tempdir().unwrap();
        let subdir = dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("nested.txt"), "Hello, world!").unwrap();

        let zip_path = zip_workflow(dir.path()).unwrap();

        assert!(zip_path.exists());
        let mut zip_reader = ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        assert_eq!(zip_reader.len(), 1);
        let file = zip_reader.by_index(0).unwrap();
        assert_eq!(file.name(), "subdir/nested.txt");
    }

    #[test]
    fn test_zip_with_ignore() {
        let dir = tempfile::tempdir().unwrap();

        let ignore_file_path = dir.path().join(".florcaignore");
        fs::write(ignore_file_path, "subdir/").unwrap();

        fs::write(dir.path().join("test.txt"), "Hello, world!").unwrap();

        let subdir = dir.path().join("subdir");
        fs::create_dir(&subdir).unwrap();
        fs::write(subdir.join("nested.txt"), "Hello, world!").unwrap();

        // Content of `dir` at this point:
        // - .florcaignore
        // - test.txt
        // - subdir/
        //   - nested.txt

        let zip_path = zip_workflow(dir.path()).unwrap();

        assert!(zip_path.exists());
        let mut zip_reader = ZipArchive::new(File::open(zip_path).unwrap()).unwrap();
        assert_eq!(zip_reader.len(), 1);
        let file = zip_reader.by_index(0).unwrap();
        assert_eq!(file.name(), "test.txt");
    }
}
