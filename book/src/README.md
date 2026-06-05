# Introduction

<div class="warning">

**_FloatingOrca_ is not ready for production use!**

_FloatingOrca_ is currently in an early stage of development and—especially security-wise—not ready for production use.
Use it at your own risk!

</div>

This book is intended to provide a comprehensive guide to the _FloatingOrca_ project, including both user and developer documentation.
However, it is still a work in progress and may contain incomplete or outdated information.
As the project evolves, this book will be updated to reflect the latest changes and improvements.

This repository also contains **qFLORCA**, a fully serverless extension of _FloatingOrca_ that realizes the same coordination model on AWS Lambda and SQS alone — with no central engine to host. It is documented in its own chapter at the end of this book: [qFLORCA — SQS-native coordination](./user-guide/qflorca.md).

Before continuing with the next chapter, [Getting started](./user-guide/getting-started.md), let's clarify some basic concepts.

## What is _FloatingOrca_?

_FloatingOrca_ (or `florca` for short) is a framework for building and running workflows in a serverless fashion.

Such workflows are composed of functions, with the output of one function serving as the input to the next.

_FloatingOrca_'s main goal is to provide a simple and flexible way to define and run workflows, while also allowing for more complex scenarios.

Important features include:

- The ability to let functions decide which function to run next.
- The ability to invoke child functions/workflows from within a function.
- The ability to create custom control flow elements.
- The ability to send messages between functions.
- The ability to expose HTTP endpoints to interact with workflows.

Furthermore, _FloatingOrca_ integrates with AWS Lambda, allowing you to run your functions in the cloud.

### The name

The name _FloatingOrca_ combines "Floating"—hinting at the similar-sounding "flow" of workflows—with "Orca", referencing orchestration, as well as subtly pointing to containerization (since orcas are whales, much like Docker's logo). Together, the name reflects the project's focus on workflow orchestration and its close ties to cloud-native technologies.

## Components

_FloatingOrca_ consists of three main components:

- The deployer service, which is responsible for deploying workflows and their functions.
- The engine service, which is responsible for running workflows.
- The CLI, which is a command-line interface for interacting with the deployer and engine services.

In addition, _FloatingOrca_ ships with the following components:

- A PostgreSQL database, which stores information about deployed workflows and their functions.
- A PostgreSQL database, which stores information about workflow runs and function invocations.
- A Caddy reverse proxy.
