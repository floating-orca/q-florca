use crate::AppState;
use anyhow::Result;
use axum::Router;
use axum::routing::{delete, get, post};
use std::sync::Arc;

mod inspection_endpoint;
mod kill_endpoint;
mod message_endpoints;
mod ps_endpoint;
mod report_endpoint;
mod run_endpoints;

pub async fn serve(shared_state: Arc<AppState>) -> Result<()> {
    let app = Router::new()
        .route("/", post(run_endpoints::run_workflow))
        .route("/", get(ps_endpoint::get_running_workflows))
        .route("/ready", post(report_endpoint::report_readiness))
        .route(
            "/{run}/inspection",
            get(inspection_endpoint::get_inspection),
        )
        .route("/{run}/invoke", post(run_endpoints::invoke_child))
        .route("/{run}/{id}", post(message_endpoints::to_function))
        .route("/{run}/{id}", get(message_endpoints::html_from_function))
        .route("/{run}", post(message_endpoints::to_workflow))
        .route("/{run}", get(message_endpoints::html_from_workflow))
        .route("/{run}", delete(kill_endpoint::kill))
        .with_state(shared_state.clone());
    let port = std::env::var("PORT").unwrap_or_else(|_| "8001".to_string());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    let kill_service = shared_state.kill_service.clone();
    axum::serve(listener, app)
        .with_graceful_shutdown(crate::shutdown_signal(kill_service))
        .await?;
    Ok(())
}
