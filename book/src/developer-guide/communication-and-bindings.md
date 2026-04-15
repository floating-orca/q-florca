# Communication & bindings

Communication between the components usually happens via HTTP, using JSON as the data format.

Most of the communication is typed. For communication between two Rust services, the types are defined in the `core` crate. For communication between Rust and TypeScript, the [`ts-rs`](https://docs.rs/ts-rs/latest/ts_rs/) crate is used to generate TypeScript bindings from Rust types.

## TypeScript bindings

TypeScript bindings are generated from Rust code and saved to the `packages/types/bindings` directory.

To (re)generate the bindings after making changes to the Rust code, run:

```bash
cargo test export_bindings
```

Rust types that should be exported to TypeScript are marked with `#[ts(export)]`.

After running the command, re-export the generated type(s) in `packages/types/mod.ts`.

### Example

The following example shows how to define a Rust type that can be exported to TypeScript using the `ts-rs` crate:

```rs
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[derive(TS)]
#[ts(export)]
pub struct LogMessage {
    pub level: LogLevel,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
#[derive(TS)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}
```

Just mark the root type with `#[derive(TS)]` and `#[ts(export)]`. All nested types should derive `TS` as well, but do not need to be marked with `#[ts(export)]`.

The corresponding TypeScript bindings would look like this:

```ts
export type LogMessage = { level: LogLevel, message: string, };
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
```
