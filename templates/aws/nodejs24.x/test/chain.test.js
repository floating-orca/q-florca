"use strict";

// Integration tests for next-chaining and context.sendMessage().
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
  waitForRunCompleted,
  peekQueue,
  pollQueue,
  drainQueue,
  driveHandler,
  randomUUID,
} = require("./helpers");

// ── next chaining ─────────────────────────────────────────────────────────────

describe("FLORCA Lambda template — next chaining", () => {
  let sqs;
  let step1Queues, step2Queues, eventsQueueUrl;
  let step1Handler, step2Handler;
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

    const lookup = {
      eventsQueueUrl,
      entries: [
        { name: "step1", ...step1Queues },
        { name: "step2", ...step2Queues },
      ],
    };

    // step1 doubles the payload and chains to step2
    step1Handler = loadHandler("step1", lookup, async ({ payload }) => ({
      next: "step2",
      payload: payload * 2,
    }));

    // step2 adds 1 to the payload and returns the final result
    step2Handler = loadHandler("step2", lookup, async ({ payload }) => ({
      payload: payload + 1,
    }));
  });

  after(async () => {
    await Promise.all(
      [eventsQueueUrl, ...Object.values(step1Queues), ...Object.values(step2Queues)].map(
        (u) => deleteQueue(sqs, u)
      )
    );
  });

  it("step1 → step2 chain emits run_completed with final payload", async () => {
    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "step1", payload: 5,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    // step1 dispatches synchronously before returning
    await step1Handler(event);

    // ESM would deliver the forwarded message to step2's invoke queue
    const step2Envelope = await pollQueue(sqs, step2Queues.invokeQueueUrl);
    assert.equal(step2Envelope.fn, "step2");
    assert.equal(step2Envelope.runId, runId);
    assert.equal(step2Envelope.payload, 10); // 5 * 2

    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      step2Handler(makeInvokeEvent(step2Envelope)),
    ]);

    assert.equal(ev.result, 11); // 10 + 1
  });

  it("two concurrent chains do not cross-contaminate", async () => {
    const runId1 = randomUUID(), runId2 = randomUUID();
    const mkEvent = (runId, payload) => makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "step1", payload,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    await Promise.all([step1Handler(mkEvent(runId1, 3)), step1Handler(mkEvent(runId2, 7))]);

    const envs = await Promise.all([
      pollQueue(sqs, step2Queues.invokeQueueUrl),
      pollQueue(sqs, step2Queues.invokeQueueUrl),
    ]);
    const byRunId = Object.fromEntries(envs.map((e) => [e.runId, e]));

    assert.equal(byRunId[runId1].payload, 6);  // 3 * 2
    assert.equal(byRunId[runId2].payload, 14); // 7 * 2

    const [ev1, ev2] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId1),
      waitForRunCompleted(sqs, eventsQueueUrl, runId2),
      step2Handler(makeInvokeEvent(byRunId[runId1])),
      step2Handler(makeInvokeEvent(byRunId[runId2])),
    ]);

    assert.equal(ev1.result, 7);  // 6 + 1
    assert.equal(ev2.result, 15); // 14 + 1
  });
});

// ── SQS bidirectional messaging ───────────────────────────────────────────────

describe("FLORCA Lambda template — bidirectional messaging (onMessage / sendMessageToParent)", () => {
  let sqs;
  let parentQueues, childQueues, eventsQueueUrl;
  let parentHandler, childHandler;
  const prefix = `t${randomUUID().slice(0, 8)}`;

  before(async () => {
    global._florca_active_contexts = [];
    sqs = makeSqs();

    [eventsQueueUrl, parentQueues, childQueues] = await Promise.all([
      sqs.send(new CreateQueueCommand({ QueueName: `${prefix}-events` })).then((r) => r.QueueUrl),
      createFunctionQueues(sqs, `${prefix}-parent`),
      createFunctionQueues(sqs, `${prefix}-child`),
    ]);

    const lookup = {
      eventsQueueUrl,
      entries: [
        { name: "parent", ...parentQueues },
        { name: "child", ...childQueues },
      ],
    };

    parentHandler = loadHandlerObject("parent", lookup, {
      handler: async ({ context }) => {
        await context.run("child", 5, "onChildComplete");
      },
      onMessage: async (msg) => {
        return msg * 2;
      },
      onChildComplete: async ({ results }) => {
        const childResult = results[0];
        return { payload: childResult };
      }
    });

    childHandler = loadHandler("child", lookup, async ({ payload, context }) => {
      const { sendMessageToParent } = require("./fn.js");
      const reply = await sendMessageToParent(payload, context);
      return { payload: reply };
    });
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
      [
        eventsQueueUrl,
        ...Object.values(parentQueues),
        ...Object.values(childQueues),
      ].map((u) => deleteQueue(sqs, u))
    );
  });

  it("successfully passes messages bidirectionally between child and parent", async () => {
    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "parent", payload: null,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });

    // Drive child when it is invoked
    const parentPromise = parentHandler(event);
    
    // Wait slightly to let the parent dispatch the child
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Drive the child invocation
    await driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, 1);

    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      parentPromise,
    ]);

    assert.equal(ev.result, 10);
  });

  it("successfully recovers from a parent crash via direct callback recovery", async () => {
    const runId = randomUUID();
    const event = makeInvokeEvent({
      runId, invocationId: randomUUID(), fn: "parent", payload: null,
      parentId: null, predecessorId: null,
      continuationState: null, returnTo: null, callerReturnTo: null,
      eventsQueueUrl, fanOutId: null, fanOutTotal: null,
    });
    const { ListQueuesCommand } = require("@aws-sdk/client-sqs");
    const listResp = await sqs.send(new ListQueuesCommand({})).catch(() => ({ QueueUrls: [] }));
    console.log("DEBUG: SQS queues at start of second test:", listResp.QueueUrls);
    // 1. Start the first parent run
    const parentPromise1 = parentHandler(event).catch((err) => {
      console.error("DEBUG parentPromise1 failed:", err);
    });

    // 2. Wait until first parent invocation has enqueued its child.
    await peekQueue(sqs, childQueues.invokeQueueUrl, 10000);

    // 3. Simulate container crash: disable cleanup queue deletion and abort first parent
    if (global._florca_active_contexts && global._florca_active_contexts.length > 0) {
      global._florca_active_contexts[0]._cleanup = async () => {};
      global._florca_active_contexts[0].abort();
    }

    // 4. Invoke the parent a second time with the exact same event envelope!
    const parentPromise2 = parentHandler(event);

    // 4. Drive the child. The child will communicate with the recovered parent!
    await new Promise((resolve) => setTimeout(resolve, 200));
    await driveHandler(sqs, childQueues.invokeQueueUrl, childHandler, 1);

    const [ev] = await Promise.all([
      waitForRunCompleted(sqs, eventsQueueUrl, runId),
      parentPromise2,
    ]);

    // Bypassing handler should still result in correct execution!
    assert.equal(ev.result, 10);
  });
});

