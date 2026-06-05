# Release notes

_See the [Upgrade](../user-guide/upgrade.md) chapter for instructions on how to upgrade to the latest version._

## v0.9.0+Q (qFLORCA)

Introduces **qFLORCA**, a fully serverless, queue-native extension that realizes FloatingOrca's coordination model on AWS Lambda and SQS alone — no engine, driver, or central service on the execution path. See the [qFLORCA](../user-guide/qflorca.md) chapter.

- All orchestration logic is embedded in an injected per-Lambda wrapper (`fn.js`); the engine and driver are not used at run time.
- Per-invocation inbox and aggregation queues replace the central engine: child results, bidirectional messaging, and crash-recovery snapshots all live in SQS queues owned by each invocation.
- The CLI invokes a workflow by sending the envelope directly to the entry function's SQS queue and streaming the events queue, rather than calling an engine.
- The CLI binary is named `qflorca` for this variant.
- Added examples: `webcrawler-batched`, `webcrawler-greedy`, `flexi-consensus-phased`, `flexi-consensus-messaging`, and the `parallel-aws-messaging` scaling workload.

This is an additive extension; the base FloatingOrca runtime is unchanged.

> **No pre-built images are published for `0.9.0+Q`.** To run this version, build it from source — see [Build from source](../user-guide/build-from-source.md). (The `compose.yaml` image tags still point at the last published release.)

## v0.9.0

- Use `UUID`s for invocation IDs instead of `SERIAL` IDs
- Let the driver communicate events to the engine via a new `POST /{run}/events` endpoint
- Move invocation persistence from the driver to the engine
- Add a lightweight `GET /{run}/status` endpoint to the engine
- Speed up inspection graph construction and rename the endpoint to `GET /{run}/inspection`
- Report workflow run completion to the engine over HTTP instead of writing results to a file

### Breaking changes

The change from `SERIAL` to `UUID` invocation IDs is not backwards compatible.

- In case one of your functions deals with invocation IDs, make sure to treat them as strings instead of integers.
- There is no database migration for this change, so you will have to delete your existing `engine` database and let it be recreated with the new schema. Just follow the instructions in the [Upgrade](../user-guide/upgrade.md) chapter.

## v0.8.1

- Remove `--locked` from `cargo build` commands
- Update Deno linter rules and imports
- Add logging to the end-to-end test image
- Additional example workflows

## v0.8.0

- Add `--json` flags and a `message` command to the CLI
- Bump AWS Lambda runtimes
  - Support for Node.js 20.x in AWS Lambda ends on April 30, 2026
- Update Rust, Deno, and dependencies
- Revise end-to-end test setup
- Bulk-insert invocations into database after workflow completion
- Add documentation for Knative on a Kubernetes cluster
- Add more examples

### Breaking changes

When running FloatingOrca natively, make sure you are running at least Rust v1.94 and Deno v2.7.9.

## v0.7.0

- Migrate the book to mdBook v0.5
- Fix a "connection refused" issue in the driver

## v0.6.0

- Add a `--force` flag to the CLI's `deploy` command to force the redeployment of functions even if their code has not changed
- Book: Specify a Kubernetes version to be used by `kind`
- Book: Describe the architecture of FloatingOrca and how it works
- Book: Describe and illustrate the control flow of a child workflow
- Update Rust, Deno, and dependencies

### Breaking changes

When running FloatingOrca natively, make sure you are running at least Rust v1.90 and Deno v2.5.1.

## v0.5.1

- Driver: Switch to a database connection pool to allow running more functions in parallel

## v0.5.0

- PoC: Let remote functions run child functions by making a `POST` request to the engine's `/{run}/invoke` endpoint (undocumented—see `examples/remote-invocation` for an example)
- Add a container image for end-to-end testing (see the [Containers](../developer-guide/containers.md) chapter)
- Mark certain Docker volumes as read-only
- Extend the Developer guide of the book
- Code improvements

### Breaking changes

The changes made to existing database migration scripts are not backwards compatible. However, if you follow the instructions in the [Upgrade](../user-guide/upgrade.md) chapter, where you'll delete all services anyway, you won't run into any issues.

## v0.4.0

- Add a section to the [Self-hosting](../user-guide/self-hosting.md) chapter that explains how to run Knative functions on a self-hosted FloatingOrca instance
- List and describe plugins shipped with FloatingOrca in the new [Default plugins](./default-plugins.md) chapter
- Allow passing an `--arbitrary` flag to the CLI's `new function` subcommand to create a function with a runtime for which no template exists
- Run the driver with a temporary (copied) `deno.lock` to avoid plugins overwriting the original
- Log messages exchanged between functions in the engine's log (`DEBUG` level)
- Add messaging functions to the templates shipped with FloatingOrca's CLI
  - See [Messaging#Sending messages from non-plugin functions](../user-guide/messaging.md#sending-messages-from-non-plugin-functions) for more information
- Configure `compose.yaml` to persist Caddy TLS certificates
- Separate the (previously single) database into two separate databases `deployer` and `engine`
- Normalize the `deployer` database schema
- Add database migrations

### Breaking changes

- The changes made to the database service are not backwards compatible. However, if you follow the instructions in the [Upgrade](../user-guide/upgrade.md) chapter, where you'll delete all services anyway, you won't run into any issues.

## v0.3.1

- Add `scripts/release.sh` and document how to release a new version
- Document how one could [self-host FloatingOrca](../user-guide/self-hosting.md) on a cloud server
- Let the reverse proxy bind to port `443` instead of `8443` so that its automatic certificate retrieval works
- Fix an issue with the deployer not being able to deploy functions that contain uppercase letters in their names
- Add an example workflow that demonstrates the communication between a Knative function and a plugin function (see `examples/kn-message`)

## v0.3.0

- Rename the project from `mt` to `florca` (and `mt-cli` to `florca`)
- Add a `logEvent` method to plugin functions' `PluginContext`
  - Allows passing a log level along the message and some optional data
  - Automatically prints the plugin function's name and invocation ID
- Allow specifying an optional `.env` file to be loaded by the CLI (using the `--env-file` parameter)
- Improve parsing of CLI arguments
- Add a `completions` command to the CLI that outputs completion scripts for the most popular shells
- Add descriptions to the CLI's commands and their arguments
- Integrate [Knative](../user-guide/knative-functions.md)
- Update function templates
- Rename `CONNECTION_STRING` to `DATABASE_URL`
- Bump Rust and Deno versions and perform required changes
- Rename `process` (the Deno process spawned by the engine upon workflow start) to `driver`
- Add support for `.florcaignore` files to skip certain files during deployment
- Extend the book with additional notes and the following chapters:
  - [Knative functions](../user-guide/knative-functions.md)
  - [Security](../user-guide/security.md)
  - [Limitations](../user-guide/limitations.md)
  - [Development environment](../developer-guide/development-environment.md)
- Allow configuring `memory` and `timeout` of [AWS Lambda functions](../user-guide/aws-lambda-functions.md) (via `function.toml`)

### Breaking changes

- The project has been renamed from `mt` to `florca`
- `mt-cli` has been renamed to `florca`
- `@mt/fn` has been renamed to `@florca/fn`
  - Make sure to update the `import` statements in your plugin functions
- The `CONNECTION_STRING` environment variable has been renamed to `DATABASE_URL`
- When `provider = "aws"` in `function.toml`, `memory` and `timeout` must be specified

  - When creating a new function, the CLI will automatically add these fields to `function.toml` with default values of `128` and `3` respectively
  - For existing AWS Lambda functions, you must add these fields manually to `function.toml`:

    ```toml
    provider = "aws"
    # ...
    memory = 128
    timeout = 3
    ```

- Log messages from the Deno process are now labelled with `driver` instead of `process`

## v0.2.0

- Add an `info` command to the CLI
- Instead of requiring the AWS CLI to be installed and configured, also read `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` and `AWS_REGION` from the environment
  - These variables override the AWS CLI configuration
- On native installations, let `.env.local` override the `.env` file
- Kill processes based on their PID instead of the workflow run ID in their name
- Join two separate requests on `inspect` and `run --wait` into one
- Document example workflows
- Add an Upgrade chapter

## v0.1.1

- Fix `kill` command
  - Was not working when the engine ran in a Docker container
- Fix error handling in CLI
  - Was not printing an error message on 502
- Fix time format inconsistencies in CLI
- Improve "output" when inspecting a killed workflow run
- Cache Rust build artifacts when building container images
- Switch to fully qualified container image names for improved Podman compatibility

## v0.1.0

- Initial release
