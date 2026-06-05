use florca_core::{deployment::DeploymentName, function::FunctionName};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct Arn(pub String);

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct AwsFunctionQualifier {
    /// Full Lambda function name: `{deployment}-{function}`
    qualifier: String,
    /// Just the function name, used to set `FLORCA_FUNCTION_NAME` in the Lambda env.
    pub function_name: String,
}

impl AwsFunctionQualifier {
    #[must_use]
    pub fn new(deployment_name: &DeploymentName, function_name: &FunctionName) -> Self {
        Self {
            qualifier: format!("{deployment_name}-{function_name}"),
            function_name: function_name.to_string(),
        }
    }
}

impl AsRef<str> for AwsFunctionQualifier {
    fn as_ref(&self) -> &str {
        &self.qualifier
    }
}

impl std::fmt::Display for AwsFunctionQualifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.qualifier.fmt(f)
    }
}
