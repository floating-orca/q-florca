use anyhow::Result;
use common::mock_aws_client::MockAwsClient;
use common::mock_kn_client::MockKnClient;
use florca_core::deployment::DeploymentName;
use florca_deployer::{
    deployer::Deployer,
    repository::SqlxDeployerRepository,
    service::{DeployerService, DeployerServiceImpl},
};
use std::{path::PathBuf, sync::Arc};
use tempfile::NamedTempFile;
use testcontainers_modules::{postgres, testcontainers::runners::AsyncRunner};

mod common;

#[tokio::test]
async fn test_deploy_and_delete() -> Result<()> {
    // Initialize the test environment

    let container = postgres::Postgres::default().start().await?;
    let host = container.get_host().await?;
    let host_port = container.get_host_port_ipv4(5432).await?;
    let database_url = format!("postgres://postgres:postgres@{host}:{host_port}/postgres");
    let repository = Arc::new(
        SqlxDeployerRepository::setup_with_database_url(&database_url)
            .await
            .unwrap(),
    );
    let aws_client = Arc::new(MockAwsClient::new());
    let kn_client = Arc::new(MockKnClient::new());
    let deployer = Arc::new(Deployer::new(
        repository.clone(),
        aws_client.clone(),
        kn_client.clone(),
    ));
    let deployer_service = DeployerServiceImpl::new(repository.clone(), deployer.clone());

    // Deploy a test deployment (twice)

    let deployment_name = DeploymentName::from("test_deployment");
    let named_zip_file = NamedTempFile::with_suffix(".zip")?;
    zip_extensions::zip_writer::zip_create_from_directory(
        &named_zip_file.path().to_path_buf(),
        &PathBuf::from("tests/data/aws-example_deployment"),
    )?;
    let bytes = tokio::fs::read(named_zip_file.path()).await?;
    deployer_service
        .deploy(&deployment_name, &bytes, false)
        .await
        .unwrap();
    deployer_service
        .deploy(&deployment_name, &bytes, false)
        .await
        .unwrap();

    // Verify the deployment

    let deployments = deployer_service.list_deployments().await.unwrap();
    assert_eq!(deployments.len(), 1);
    assert_eq!(deployments[0], deployment_name);
    let deployment = deployer
        .repository
        .get_deployment(&deployment_name)
        .await
        .unwrap();
    assert!(deployment.is_some());
    let deployment = deployment.unwrap();
    assert_eq!(deployment.name, deployment_name);

    // Verify the functions are persisted and deployed

    let functions = deployer
        .repository
        .get_functions(deployment.id)
        .await
        .unwrap();
    assert_eq!(functions.len(), 3);
    {
        let aws_functions = aws_client.functions.read().await;
        assert_eq!(aws_functions.len(), 1);
    }
    {
        let kn_functions = kn_client.functions.read().await;
        assert_eq!(kn_functions.len(), 0);
    }
    
    // verify the deployment has the events queue arn set
    assert!(deployment.events_queue_arn.is_some());

    // verify each AWS function has invoke queue arn set
    for function in &functions {
        if let florca_core::function::FunctionEntity::Aws(aws) = function {
            assert!(aws.invoke_queue_arn.is_some());
            assert!(aws.invoke_esm_uuid.is_some());
        }
    }
    
    // Delete the deployment

    deployer_service
        .delete_deployment(&deployment_name)
        .await
        .unwrap();

    // Verify the deployment is deleted

    let deployments = deployer_service.list_deployments().await.unwrap();
    assert!(deployments.is_empty());

    // Verify the functions are deleted and undeployed

    let functions = deployer
        .repository
        .get_functions(deployment.id)
        .await
        .unwrap();
    assert!(functions.is_empty());
    {
        let aws_functions = aws_client.functions.read().await;
        assert!(aws_functions.is_empty());
    }
    {
        let kn_functions = kn_client.functions.read().await;
        assert!(kn_functions.is_empty());
    }

    Ok(())
}
