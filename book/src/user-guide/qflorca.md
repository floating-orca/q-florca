# qFLORCA — SQS-Native, Serverless Coordination

_FloatingOrca_ (FLORCA) implements three coordination primitives — **child invocation** (`context.run`), **sequential chaining** (`next`), and **bidirectional messaging** (`sendMessageToParent` / `onMessage`) — through a central engine and driver. The engine acts as coordinator: it receives invocation requests, drives the workflow, and mediates communication between functions.

This chapter describes **qFLORCA** (queue-native FLORCA), a separate extension that demonstrates the same three primitives can be realised without any central coordinator, using only AWS Lambda functions and SQS queues. All orchestration logic is embedded directly into the Lambda functions via an injected system wrapper (`fn.js`). There is nothing to host beyond the functions themselves.

The system is completely serverless, requires no infrastructure to operate or scale, and provides built-in crash recovery: execution state is persisted to a per-invocation aggregation queue before children are dispatched, so a Lambda container death is transparent to the caller.

The primary goal of qFLORCA is to show that _FloatingOrca_'s coordination model is not tied to its engine implementation. The same primitives, the same semantics, can be achieved with functions and queues alone.

---

## Architecture

The deployer provisions exactly **one** SQS queue per function:

- **Invoke queue** — receives invocation envelopes from the CLI or from other functions. An Event Source Mapping (ESM) delivers these records to the Lambda.

Everything else is **per-invocation**, created lazily by the wrapper the first time `context.run` / `runAll` is called and deleted when the invocation completes:

- **Inbox queue** (`${invocationId}-inbox`) — the return address for child results and the destination for bidirectional messages.
- **Aggregation queue** (`${invocationId}-agg`) — holds the execution snapshot (batch state plus collected child results) for crash recovery.

Because each invocation owns its inbox and aggregation queues, concurrent invocations never contend for a shared queue, and recovery is unambiguous: a re-invoked Lambda detects that it is recovering simply by checking whether its inbox queue still exists. Queue names are derived from the invocation ID; since deterministic IDs encode the full call ancestry and can exceed the SQS 80-character name limit at depth, over-long names are hashed to a bounded, collision-resistant form.

On delivery, the wrapper parses the envelope and dispatches to either the main handler or, in crash-recovery mode, directly to the registered callback.

### Runtime footprint

This is the structural payoff of qFLORCA: most of FLORCA's runtime disappears. A full FLORCA deployment runs a **deployer**, an **engine**, a per-run **driver**, two PostgreSQL databases, and a Caddy reverse proxy. In qFLORCA, the engine and driver are gone entirely — their coordinator role (driving the workflow, mediating messages, persisting state) is embedded in the wrapper that runs *inside each Lambda*. There is no central service on the execution path.

What remains is only:

- **The deployer** (and its `deployer` PostgreSQL database) — used at *deploy time* to provision functions, their invoke queues, ESMs, and the events queue, and to record deployment metadata. It plays no part in execution.
- **Caddy**, fronting the deployer.

At *run time*, the CLI talks to nobody but AWS: it fetches the deployment manifest from the deployer once, then sends the invocation envelope **directly to the entry function's SQS invoke queue** and reads the events queue until the run terminates. No HTTP call to an engine is made, and nothing FLORCA-specific needs to be hosted to run a workflow — only the Lambda functions and their queues, both of which are managed by AWS.

---

## Primitive 1: `context.run` — Fan-out with Named Callbacks

In the vanilla engine model, `context.run(fn, payload)` returns a `Promise` that resolves when the child completes. In the SQS-native model this is not possible across Lambda invocations: the parent Lambda exits after dispatching and is re-triggered by a future event. Instead, `context.run` is a **suspending operation**: it dispatches the child, persists state to the aggregated queue, and suspends. When the child completes it delivers its result to the parent's inbox queue; the parent is re-invoked and the wrapper routes the result to the registered callback.

The callback must be **statically exported** on the module. The wrapper calls it by name, both on first completion and during crash recovery.

```javascript
// parent/aws/index.js
"use strict";

module.exports = {
  handler: async ({ payload, context }) => {
    await context.run("child", payload, "onChildComplete");
    // nothing after context.run is guaranteed to execute
  },

  onChildComplete: async ({ results, context }) => {
    return { payload: results[0] };
  },
};
```

```javascript
// child/aws/index.js
"use strict";

module.exports = {
  handler: async ({ payload }) => {
    return { payload: payload + 1 };
  },
};
```

For fan-out across multiple children:

```javascript
handler: async ({ payload, context }) => {
  const tasks = payload.map((item) => ({ fn: "child", payload: item }));
  await context.runAll(tasks, "onBatchComplete");
},

onBatchComplete: async ({ results }) => {
  return { payload: results.sort((a, b) => a - b) };
},
```

**Crash recovery.** If the parent Lambda dies after dispatching but before the child returns, the ESM re-delivers the original invoke message. On re-invocation, the wrapper reads the aggregated queue, finds the saved batch state, skips the main handler entirely, and waits for the already-dispatched child to deliver its result. `onBatchComplete` is then called exactly once, as if no crash occurred.

---

## Primitive 2: Next-Chaining

Return `{ next: "fnName", payload: ... }` from any handler to chain execution to the next function. The wrapper sends the invocation envelope directly to the next function's invoke queue — no engine is involved, no HTTP call is made.

```javascript
// step1/aws/index.js
"use strict";

module.exports = {
  handler: async ({ payload }) => {
    return { next: "step2", payload: payload * 2 };
  },
};
```

```javascript
// step2/aws/index.js
"use strict";

module.exports = {
  handler: async ({ payload }) => {
    return { payload: payload + 1 };
  },
};
```

Chains of arbitrary length are supported. Each step is an independent Lambda invocation; the only shared state is the payload passed through `next`.

---

## Primitive 3: `sendMessageToParent` — Bidirectional Messaging

A child can send a message to its parent and await a reply within the same invocation. The parent receives the message through its exported `onMessage` handler; the return value is sent back as the reply.

```javascript
// parent/aws/index.js
"use strict";

module.exports = {
  handler: async ({ payload, context }) => {
    await context.run("child", payload, "onChildComplete");
  },

  onMessage: async (message) => {
    // called when the child sends a query; return value is the reply
    return message * 2;
  },

  onChildComplete: async ({ results }) => {
    return { payload: results[0] };
  },
};
```

```javascript
// child/aws/index.js
"use strict";

const { sendMessageToParent } = require("./fn.js");

module.exports = {
  handler: async ({ payload, context }) => {
    const reply = await sendMessageToParent(payload, context);
    return { payload: reply };
  },
};
```

The wrapper creates a private per-invocation inbox queue for the parent. The child addresses the parent by invocation ID; the parent's internal poller receives the message, calls `onMessage`, and routes the reply back to the child's inbox. After the invocation completes, the inbox is deleted.

`onMessage` is opportunistic — it is processed while the poller is already running to collect child results. It does not create an independent wait; barriers are established by `context.run`, not by `onMessage`.

**During crash recovery**, the inbox queue is intentionally not deleted on crash. On re-invocation, the wrapper reconstructs its context against the same inbox URL. When the child is re-driven by the ESM, it sends its message to the same inbox and the recovered parent handles it normally.

---

## Deployment

> **No pre-built images are published for this version (`0.9.0+Q`).** Build the CLI and the deployer from source first — see [Build from source](./build-from-source.md).

Functions are deployed the same way as any other AWS Lambda function in _FloatingOrca_, using the `qflorca` CLI:

```bash
qflorca deploy --workflow-directory examples/bidirectional-aws-messaging
```

The deployer provisions all required queues and ESM triggers. Each function's `function.toml` specifies the Node.js runtime:

```toml
provider = "aws"
handler = "index.handler"
runtime = "nodejs24.x"
memory = 128
timeout = 30
```

To trigger a workflow, use `qflorca invoke`:

```bash
qflorca invoke --deployment-name bidirectional-aws-messaging --input 5
```

This sends the invocation envelope directly to the entry function's SQS invoke queue and streams events until `run_completed` or `run_failed` is received.
