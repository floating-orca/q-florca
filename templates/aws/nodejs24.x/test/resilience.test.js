"use strict";

// Resilience tests: re-invocation after crash and timeout via replay model.
// Requires LocalStack running at LOCALSTACK_ENDPOINT (default: http://localhost:4566).

const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { CreateQueueCommand } = require("@aws-sdk/client-sqs");
const {
  makeSqs,
  createFunctionQueues,
  deleteQueue,
  loadHandler,
  loadHandlerObject,
  makeInvokeEvent,
  driveHandler,
  waitForEvent,
  waitForRunCompleted,
  peekQueue,
  peekInvocationAggQueue,
  randomUUID,
} = require("./helpers");

// ── Timeout via replay model ──────────────────────────────────────────────────

describe("FLORCA Lambda template — fan-out timeout (replay model)", () => {
  let sqs;
  let startQueues, childQueues, eventsQueueUrl;
  const prefix = `t${randomUUID().slice(0, 8)}`;

  before(async () => {
    global._florca_active_contexts = [];
    sqs = makeSqs();
    eventsQueueUrl = (
      await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-events` }))
    ).QueueUrl;
    [startQueues, childQueues] = await Promise.all([
      createFunctionQueues(sqs, `${prefix}-start`),
      createFunctionQueues(sqs, `${prefix}-child`),
    ]);
  });

  afterEach(async () => {
    if (global._florca_active_contexts) {
      for (const ctx of global._florca_active_contexts) {
        ctx.abort();
      }
      global._florca_active_contexts = [];
    }
  });

  after(async () => {
    await Promise.all(
      [eventsQueueUrl, ...Object.values(startQueues), ...Object.values(childQueues)].map(
        (u) => deleteQueue(sqs, u)
      )
    );
  });

  it("parent emits TimeoutError when re-invoked after snapshot exceeds fanOutTimeoutMs", async () => {
    // Very short deadline so the first invocation gives up quickly,
    // and fanOutTimeoutMs=0 so the second invocation immediately detects timeout.
    process.env.FLORCA_LAMBDA_TIMEOUT_MS = "200";
    const handler = loadHandlerObject("start", {
      eventsQueueUrl,
      entries: [
        { name: "start", ...startQueues, fanOutTimeoutMs: 0 },
        { name: "child", ...childQueues, fanOutTimeoutMs: 0 },
      ],
    }, {
      handler: async ({ payload, context }) => {
        const n = payload;
        const tasks = Array.from({ length: n }, (_, i) => ({ fn: "child", payload: i }));
        await context.runAll(tasks, "onBatchComplete");
      },
      onBatchComplete: async ({ results }) => {
        return { payload: results };
      }
    });
    delete process.env.FLORCA_LAMBDA_TIMEOUT_MS;

    const N = 3;
    const runId = randomUUID();
    const invocationId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId, fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    // First invocation: dispatches N children, deadline fires after 200ms, throws.
    // No workers — children never respond.
    await handler(event).catch(() => {});

    // Re-invoke with same event. Snapshot exists and startedAt is in the past,
    // fanOutTimeoutMs=0 → immediately detected as timed out.
    const [ev] = await Promise.all([
      waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "function_failed" && e.runId === runId),
      handler(event),
    ]);

    assert.equal(ev.type, "function_failed");
    assert.equal(ev.error.kind, "TimeoutError");

    const terminalEv = await waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "run_failed" && e.runId === runId);
    assert.equal(terminalEv.type, "run_failed");
  });
});

// ── Re-invocation after crash ─────────────────────────────────────────────────

describe("FLORCA Lambda template — re-invocation after crash", () => {
  let sqs;
  let startQueues, childQueues, eventsQueueUrl;
  let startHandler, childHandler;
  const prefix = `t${randomUUID().slice(0, 8)}`;

  before(async () => {
    global._florca_active_contexts = [];
    sqs = makeSqs();
    eventsQueueUrl = (
      await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-events` }))
    ).QueueUrl;
    [startQueues, childQueues] = await Promise.all([
      createFunctionQueues(sqs, `${prefix}-start`),
      createFunctionQueues(sqs, `${prefix}-child`),
    ]);

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
    childHandler = loadHandler("child", lookup, async ({ payload }) => ({ payload: payload + 1 }));
  });

  afterEach(async () => {
    if (global._florca_active_contexts) {
      for (const ctx of global._florca_active_contexts) {
        ctx.abort();
      }
      global._florca_active_contexts = [];
    }
  });

  after(async () => {
    await Promise.all(
      [eventsQueueUrl, ...Object.values(startQueues), ...Object.values(childQueues)].map(
        (u) => deleteQueue(sqs, u)
      )
    );
  });

  it("re-invoked parent succeeds even though first invocation's children are still in the queue", async () => {
    const N = 2;
    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    // First invocation starts — simulates Lambda crash.
    const firstInvocation = startHandler(event).catch(() => {});

    // Wait until first invocation has enqueued its children.
    await peekQueue(sqs, childQueues.invokeQueueUrl, 10000);

    // Abort the first parent invocation to simulate container death.
    // We override _cleanup to be a no-op so that the SQS inbox queue is not deleted,
    // which matches a real AWS Lambda crash where the process is killed instantly.
    if (global._florca_active_contexts && global._florca_active_contexts.length > 0) {
      global._florca_active_contexts[0]._cleanup = async () => {};
      global._florca_active_contexts[0].abort();
    }

    // Second invocation with the same event (ESM re-delivery).
    // The direct callback recovery model: second invocation loads the batch state,
    // bypasses the handler, and processes the child results.
    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      firstInvocation,
      startHandler(event),
      driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, N),
    ]);

    assert.deepEqual(ev.result, [1, 2]);
  });
});

// ── Per-invocation agg queue: recovery detection ──────────────────────────────

describe("FLORCA Lambda template — per-invocation agg queue recovery", () => {
  let sqs;
  let startQueues, childQueues, eventsQueueUrl;
  let startHandler, childHandler;
  const prefix = `t${randomUUID().slice(0, 8)}`;

  before(async () => {
    global._florca_active_contexts = [];
    sqs = makeSqs();
    eventsQueueUrl = (
      await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-events` }))
    ).QueueUrl;
    [startQueues, childQueues] = await Promise.all([
      createFunctionQueues(sqs, `${prefix}-start`),
      createFunctionQueues(sqs, `${prefix}-child`),
    ]);

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
    childHandler = loadHandler("child", lookup, async ({ payload }) => ({ payload: payload + 1 }));
  });

  afterEach(async () => {
    if (global._florca_active_contexts) {
      for (const ctx of global._florca_active_contexts) {
        ctx.abort();
      }
      global._florca_active_contexts = [];
    }
  });

  after(async () => {
    await Promise.all(
      [eventsQueueUrl, ...Object.values(startQueues), ...Object.values(childQueues)].map(
        (u) => deleteQueue(sqs, u)
      )
    );
  });

  it("re-invocation reads per-invocation agg queue and avoids re-dispatching children", async () => {
    const N = 3;
    const runId = randomUUID();
    const invocationId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId, fn: "start", payload: N,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    // First invocation: dispatches N children, creates per-invocation inbox+agg queue.
    const firstInvocation = startHandler(event).catch(() => {});

    // Wait until children have been enqueued and at least 1 result has been
    // written back to the agg queue (meaning persistState ran at least once).
    await peekQueue(sqs, childQueues.invokeQueueUrl, 10000);
    await driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, 1);

    // Wait until the agg queue has at least 1 result captured.
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const snap = await peekInvocationAggQueue(sqs, invocationId);
      if (snap && snap.results && Object.keys(snap.results).length >= 1) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // Abort Lambda 1 without cleanup — simulates crash (inbox + agg survive).
    if (global._florca_active_contexts && global._florca_active_contexts.length > 0) {
      global._florca_active_contexts[0]._cleanup = async () => {};
      global._florca_active_contexts[0].abort();
    }
    await firstInvocation;

    // Lambda 2: same event (ESM re-delivery). Should find the per-invocation agg
    // queue, read the snapshot, and complete without re-dispatching all children.
    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      startHandler(event),
      // Drive remaining children (at most N-1, since 1 was already processed).
      driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, N - 1),
    ]);

    assert.deepEqual(ev.result, [1, 2, 3]);
  });
});
