"use strict";

// Integration tests for the FLORCA AWS Lambda template.
// Requires LocalStack running at LOCALSTACK_ENDPOINT (default: http://localhost:4566).

const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { CreateQueueCommand } = require("@aws-sdk/client-sqs");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  makeSqs,
  createFunctionQueues,
  deleteQueue,
  loadHandler,
  makeInvokeEvent,
  driveHandler,
  waitForRunCompleted,
  peekQueue,
  peekInvocationAggQueue,
  drainQueue,
  randomUUID,
} = require("./helpers");

const HANDLER_DIR = path.join(__dirname, "..");
const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const REGION = "us-east-1";

function loadHandlerObject(fnName, lookup, handlers) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "florca-test-"));
  fs.copyFileSync(path.join(HANDLER_DIR, "fn.js"), path.join(tmpDir, "fn.js"));
  fs.copyFileSync(
    path.join(HANDLER_DIR, "index.js"),
    path.join(tmpDir, "index.js")
  );
  fs.writeFileSync(path.join(tmpDir, "lookup.json"), JSON.stringify(lookup));
  fs.symlinkSync(
    path.join(__dirname, "node_modules"),
    path.join(tmpDir, "node_modules")
  );
  
  const exportsStr = Object.entries(handlers)
    .map(([name, fn]) => `${name}: ${fn.toString()}`)
    .join(",\n");
    
  fs.writeFileSync(
    path.join(tmpDir, "_index.js"),
    `"use strict";\nmodule.exports = {\n${exportsStr}\n};\n`
  );
  
  process.env.FLORCA_FUNCTION_NAME = fnName;
  process.env.AWS_ENDPOINT_URL = ENDPOINT;
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.AWS_REGION = REGION;

  const { handler } = require(path.join(tmpDir, "index.js"));
  return handler;
}

// ── Shared user functions ─────────────────────────────────────────────────────

const startFn = async ({ payload, context }) => {
  const n = payload;
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) => context.run("child", i))
  );
  return { payload: results.sort((a, b) => a - b) };
};

const childFn = async ({ payload }) => ({ payload: payload + 1 });

const failingChildFn = async () => { throw new Error("child failed"); };

// ── Test suite ────────────────────────────────────────────────────────────────

describe("FLORCA Lambda template — fan-out via context.run()", () => {
  let sqs;
  let startQueues, childQueues, eventsQueueUrl;
  let startHandler, childHandler;
  const prefix = `t${Date.now()}`;

  before(async () => {
    global._florca_active_contexts = [];
    sqs = makeSqs();

    eventsQueueUrl = (
      await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-events` }))
    ).QueueUrl;

    startQueues = await createFunctionQueues(sqs, `${prefix}-start`);
    childQueues = await createFunctionQueues(sqs, `${prefix}-child`);

    const lookup = {
      eventsQueueUrl,
      entries: [
        { name: "start", ...startQueues, fanOutTimeoutMs: 600000 },
        { name: "child", ...childQueues, fanOutTimeoutMs: 600000 },
      ],
    };

    startHandler = loadHandlerObject("start", lookup, {
      handler: async ({ payload, context }) => {
        const n = payload;
        const tasks = Array.from({ length: n }, (_, i) => ({ fn: "child", payload: i }));
        await context.runAll(tasks, "onBatchComplete");
      },
      onBatchComplete: async ({ results }) => {
        return { payload: results.sort((a, b) => a - b) };
      }
    });
    childHandler = loadHandler("child", lookup, childFn);
  });

  after(async () => {
    await Promise.all([
      eventsQueueUrl,
      ...Object.values(startQueues),
      ...Object.values(childQueues),
    ].map((u) => deleteQueue(sqs, u)));
  });

  afterEach(async () => {
    // 1. Abort any active background pollers
    if (global._florca_active_contexts) {
      for (const ctx of global._florca_active_contexts) {
        ctx.abort();
      }
      global._florca_active_contexts = [];
    }
    // 2. Drain all shared SQS queues to start next tests with a completely clean slate
    await Promise.all([
      eventsQueueUrl && drainQueue(sqs, eventsQueueUrl),
      startQueues && drainQueue(sqs, startQueues.invokeQueueUrl),
      childQueues && drainQueue(sqs, childQueues.invokeQueueUrl),
    ].filter(Boolean));
  });

  it("collects all results from N=5 concurrent children", async () => {
    const N = 5;
    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      startHandler(event),
      driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, N),
    ]);

    assert.deepEqual(ev.result, [1, 2, 3, 4, 5]);
  });

  it("collects all results from N=20 concurrent children", async () => {
    const N = 20;
    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      startHandler(event),
      driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, N),
    ]);

    assert.deepEqual(ev.result, Array.from({ length: N }, (_, i) => i + 1));
  });

  it("two concurrent fan-outs do not cross-contaminate results", async () => {
    const N1 = 7, N2 = 5;
    const runId1 = randomUUID(), runId2 = randomUUID();

    const startQueues2 = await createFunctionQueues(sqs, `${prefix}-2-start`);
    const childQueues2 = await createFunctionQueues(sqs, `${prefix}-2-child`);
    const eventsQueueUrl2 = (
      await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-2-events` }))
    ).QueueUrl;

    const lookup2 = {
      eventsQueueUrl: eventsQueueUrl2,
      entries: [
        { name: "start", ...startQueues2, fanOutTimeoutMs: 600000 },
        { name: "child", ...childQueues2, fanOutTimeoutMs: 600000 },
      ],
    };

    const startHandler2 = loadHandlerObject("start", lookup2, {
      handler: async ({ payload, context }) => {
        const n = payload;
        const tasks = Array.from({ length: n }, (_, i) => ({ fn: "child", payload: i }));
        await context.runAll(tasks, "onBatchComplete");
      },
      onBatchComplete: async ({ results }) => {
        return { payload: results.sort((a, b) => a - b) };
      }
    });
    const childHandler2 = loadHandler("child", lookup2, childFn);

    try {
      const mkEvent = (runId, payload, eqUrl) => makeInvokeEvent({
        runId, invocationId: randomUUID(), fn: "start", payload,
        parentId: null, predecessorId: null,
        continuationState: null, returnTo: null, callerReturnTo: null,
        eventsQueueUrl: eqUrl, fanOutId: null, fanOutTotal: null,
      });

      const [ev1, ev2] = await Promise.all([
        waitForRunCompleted(sqs, eventsQueueUrl, runId1, 60000),
        waitForRunCompleted(sqs, eventsQueueUrl2, runId2, 60000),
        startHandler(mkEvent(runId1, N1, eventsQueueUrl)),
        startHandler2(mkEvent(runId2, N2, eventsQueueUrl2)),
        driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, N1),
        driveHandler(sqs, childQueues2.invokeQueueUrl, childHandler2, N2),
      ]);

      assert.deepEqual(ev1.result, Array.from({ length: N1 }, (_, i) => i + 1));
      assert.deepEqual(ev2.result, Array.from({ length: N2 }, (_, i) => i + 1));
    } finally {
      await Promise.all([
        eventsQueueUrl2,
        ...Object.values(startQueues2),
        ...Object.values(childQueues2),
      ].map((u) => deleteQueue(sqs, u)));
    }
  });

  it("propagates a child error through context.run()", async () => {
    const lookup = {
      eventsQueueUrl,
      entries: [
        { name: "start", ...startQueues, fanOutTimeoutMs: 600000 },
        { name: "child", ...childQueues, fanOutTimeoutMs: 600000 },
      ],
    };
    const errStartHandler = loadHandlerObject("start", lookup, {
      handler: async ({ payload, context }) => {
        await context.run("child", payload, "onChildComplete");
      },
      onChildComplete: async ({ results }) => {
        const res = results[0];
        if (res && res.error) {
          return { payload: `caught: ${res.error.message}` };
        }
        return { payload: "no error" };
      }
    });
    const failingChildHandler = loadHandler("child", lookup, failingChildFn);

    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: 42,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      errStartHandler(event),
      driveHandler(sqs, childQueues.invokeQueueUrl, failingChildHandler, 1),
    ]);

    assert.ok(
      typeof ev.result === "string" && ev.result.startsWith("caught:"),
      `expected caught error, got: ${JSON.stringify(ev.result)}`
    );
  });

  it("agg queue is empty after successful completion", async () => {
    const N = 3;
    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      startHandler(event),
      driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, N),
    ]);

    await new Promise((r) => setTimeout(r, 500));
  });

  it("supports stateless named callbacks with context.runAll and explicit state", async () => {
    const N = 4;
    const runId = randomUUID();

    const startQueues2 = await createFunctionQueues(sqs, `${prefix}-cb-start`);
    const childQueues2 = await createFunctionQueues(sqs, `${prefix}-cb-child`);

    const lookup2 = {
      eventsQueueUrl,
      entries: [
        { name: "start", ...startQueues2, fanOutTimeoutMs: 600000 },
        { name: "child", ...childQueues2, fanOutTimeoutMs: 600000 },
      ],
    };

    const handler = loadHandlerObject("start", lookup2, {
      handler: async ({ payload, context }) => {
        const n = payload;
        const tasks = Array.from({ length: n }, (_, i) => ({ fn: "child", payload: i }));
        await context.runAll(tasks, "onBatchComplete", { n });
      },
      onBatchComplete: async ({ results, state, context }) => {
        const sorted = [...results].sort((a, b) => a - b);
        return { payload: sorted };
      }
    });

    const childHandler2 = loadHandler("child", lookup2, childFn);

    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    try {
      const [ev] = await Promise.all([
        waitForRunCompleted(sqs, eventsQueueUrl, runId),
        handler(event),
        driveHandler(sqs, childQueues2.invokeQueueUrl, childHandler2, N),
      ]);

      assert.deepEqual(ev.result, Array.from({ length: N }, (_, i) => i + 1));
    } finally {
      await Promise.all([
        ...Object.values(startQueues2),
        ...Object.values(childQueues2),
      ].map((u) => deleteQueue(sqs, u)));
    }
  });

  it("stateless named callbacks recover successfully after a crash", async () => {
    const N = 3;
    const runId = randomUUID();

    const startQueues2 = await createFunctionQueues(sqs, `${prefix}-crash-start`);
    const childQueues2 = await createFunctionQueues(sqs, `${prefix}-crash-child`);

    const lookup2 = {
      eventsQueueUrl,
      entries: [
        { name: "start", ...startQueues2, fanOutTimeoutMs: 600000 },
        { name: "child", ...childQueues2, fanOutTimeoutMs: 600000 },
      ],
    };

    const handler = loadHandlerObject("start", lookup2, {
      handler: async ({ payload, context }) => {
        const n = payload;
        const tasks = Array.from({ length: n }, (_, i) => ({ fn: "child", payload: i }));
        await context.runAll(tasks, "onBatchComplete", { n });
      },
      onBatchComplete: async ({ results, state, context }) => {
        const sorted = [...results].sort((a, b) => a - b);
        return { payload: sorted };
      }
    });

    const childHandler2 = loadHandler("child", lookup2, childFn);

    const firstEvent = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    try {
      const firstInvocation = handler(firstEvent);

      await peekQueue(sqs, childQueues2.invokeQueueUrl, 10000);

      await driveHandler(sqs, childQueues2.invokeQueueUrl, childHandler2, 2);

      // Wait until the first parent has processed those 2 child results
      // and successfully written the aggregated state snapshot to its per-invocation agg queue.
      const firstInvocationId = JSON.parse(firstEvent.Records[0].body).invocationId;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const snap = await peekInvocationAggQueue(sqs, firstInvocationId);
        if (snap && snap.results && Object.keys(snap.results).length >= 2) {
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      // Simulate crash: override _cleanup so queues survive, then abort.
      if (global._florca_active_contexts) {
        for (const ctx of global._florca_active_contexts) {
          ctx._cleanup = async () => {};
          ctx.abort();
        }
        global._florca_active_contexts = [];
      }

      // Start the recovery handler
      const secondInvocation = handler(firstEvent);

      // Wait a brief moment to ensure the second parent has recreated the inbox queue
      await new Promise((r) => setTimeout(r, 1000));

      const [ev] = await Promise.all([
        waitForRunCompleted(sqs, eventsQueueUrl, runId),
        secondInvocation,
        // Drive exactly the 1 remaining task (since 2 of the 3 tasks are already in the snapshot)
        driveHandler(sqs, childQueues2.invokeQueueUrl, childHandler2, 1),
      ]);

      assert.deepEqual(ev.result, Array.from({ length: N }, (_, i) => i + 1));
    } finally {
      await Promise.all([
        ...Object.values(startQueues2),
        ...Object.values(childQueues2),
      ].map((u) => deleteQueue(sqs, u)));
    }
  });
});
