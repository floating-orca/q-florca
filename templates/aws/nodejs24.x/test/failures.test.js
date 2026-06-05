"use strict";

// Integration tests for failure paths: throwing user functions, uncaught child
// errors, and failures at each step of a next-chain.
// Requires LocalStack running at LOCALSTACK_ENDPOINT (default: http://localhost:4566).

const { describe, it, before, after } = require("node:test");
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
  pollQueue,
  drainQueue,
  randomUUID,
} = require("./helpers");

// ── Fan-out failure paths ─────────────────────────────────────────────────────

describe("FLORCA Lambda template — failure paths (fan-out / context.run())", () => {
  let sqs;
  let startQueues, childQueues, eventsQueueUrl;
  const prefix = `t${randomUUID().slice(0, 8)}`;

  before(async () => {
    sqs = makeSqs();
    eventsQueueUrl = (
      await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-events` }))
    ).QueueUrl;
    [startQueues, childQueues] = await Promise.all([
      createFunctionQueues(sqs, `${prefix}-start`),
      createFunctionQueues(sqs, `${prefix}-child`),
    ]);
  });

  after(async () => {
    await Promise.all(
      [eventsQueueUrl, ...Object.values(startQueues), ...Object.values(childQueues)].map(
        (u) => deleteQueue(sqs, u)
      )
    );
  });

  function makeLookup(evUrl) {
    return {
      eventsQueueUrl: evUrl,
      entries: [
        { name: "start", ...startQueues, fanOutTimeoutMs: 600000 },
        { name: "child", ...childQueues, fanOutTimeoutMs: 600000 },
      ],
    };
  }

  it("emits run_failed when top-level handler throws (no returnTo)", async () => {
    const handler = loadHandler("start", makeLookup(eventsQueueUrl), async () => {
      throw new Error("top-level failure");
    });

    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: null,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "run_failed" && e.runId === runId),
      handler(event),
    ]);

    assert.equal(ev.type, "run_failed");
    assert.equal(ev.error.message, "top-level failure");
  });

  it("emits function_failed when user function throws directly", async () => {
    const handler = loadHandler("start", makeLookup(eventsQueueUrl), async () => {
      throw new Error("direct failure");
    });

    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: null,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "function_failed" && e.runId === runId),
      handler(event),
    ]);

    assert.equal(ev.type, "function_failed");
    assert.equal(ev.fn, "start");
    assert.equal(ev.error.message, "direct failure");
  });

  it("uncaught child error propagates as parent function_failed", async () => {
    const lookup = makeLookup(eventsQueueUrl);
    const handler = loadHandlerObject("start", lookup, {
      handler: async ({ payload, context }) => {
        await context.run("child", payload, "onChildComplete");
      },
      onChildComplete: async ({ results }) => {
        const res = results[0];
        if (res && res.error) {
          throw new Error(res.error.message);
        }
        return { payload: res };
      }
    });
    const failingChildHandler = loadHandler("child", lookup, async () => {
      throw new Error("child exploded");
    });

    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "start", payload: 42,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "function_failed" && e.runId === runId && e.fn === "start"),
      handler(event),
      driveHandler(sqs, childQueues.invokeQueueUrl, failingChildHandler, 1),
    ]);

    assert.equal(ev.fn, "start");
    assert.ok(ev.error.message, "error message should be set");
  });
});

// ── Chain failure paths ───────────────────────────────────────────────────────

describe("FLORCA Lambda template — failure paths (next chaining)", () => {
  let sqs;
  let step1Queues, step2Queues, eventsQueueUrl;
  const prefix = `t${randomUUID().slice(0, 8)}`;

  before(async () => {
    sqs = makeSqs();
    eventsQueueUrl = (
      await sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-events` }))
    ).QueueUrl;
    [step1Queues, step2Queues] = await Promise.all([
      createFunctionQueues(sqs, `${prefix}-step1`),
      createFunctionQueues(sqs, `${prefix}-step2`),
    ]);
  });

  after(async () => {
    await Promise.all(
      [eventsQueueUrl, ...Object.values(step1Queues), ...Object.values(step2Queues)].map(
        (u) => deleteQueue(sqs, u)
      )
    );
  });

  function makeLookup(evUrl) {
    return {
      eventsQueueUrl: evUrl,
      entries: [
        { name: "step1", ...step1Queues, fanOutTimeoutMs: 600000 },
        { name: "step2", ...step2Queues, fanOutTimeoutMs: 600000 },
      ],
    };
  }

  it("step1 failure: function_failed emitted, step2 invoke queue stays empty", async () => {
    const step1Handler = loadHandler("step1", makeLookup(eventsQueueUrl), async () => {
      throw new Error("step1 exploded");
    });

    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "step1", payload: 10,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "function_failed" && e.runId === runId),
      step1Handler(event),
    ]);

    assert.equal(ev.fn, "step1");
    assert.equal(ev.error.message, "step1 exploded");

    const step2Messages = await drainQueue(sqs, step2Queues.invokeQueueUrl);
    assert.equal(step2Messages.length, 0, "step2 invoke queue should be empty after step1 failure");
  });

  it("emits run_failed when handler returns an unknown next function", async () => {
    const step1Handler = loadHandler("step1", makeLookup(eventsQueueUrl), async () => ({
      next: "nonexistent_function",
      payload: 99,
    }));

    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "step1", payload: null,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    const [ev] = await Promise.all([
      waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "run_failed" && e.runId === runId),
      step1Handler(event),
    ]);

    assert.equal(ev.type, "run_failed");
    assert.ok(ev.error.message.includes("nonexistent_function"), `error should name the unknown function, got: ${ev.error.message}`);
  });

  it("step2 failure: function_failed emitted after step1 succeeds", async () => {
    const lookup = makeLookup(eventsQueueUrl);
    const step1Handler = loadHandler("step1", lookup, async ({ payload }) => ({
      next: "step2",
      payload: payload * 2,
    }));
    const step2Handler = loadHandler("step2", lookup, async () => {
      throw new Error("step2 exploded");
    });

    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "step1", payload: 5,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    await step1Handler(event);

    const step2Envelope = await pollQueue(sqs, step2Queues.invokeQueueUrl);
    assert.equal(step2Envelope.payload, 10);

    const [ev] = await Promise.all([
      waitForEvent(sqs, eventsQueueUrl, (e) => e.type === "function_failed" && e.runId === runId && e.fn === "step2"),
      step2Handler(makeInvokeEvent(step2Envelope)),
    ]);

    assert.equal(ev.fn, "step2");
    assert.equal(ev.error.message, "step2 exploded");
  });
});
