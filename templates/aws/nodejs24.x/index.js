// FLORCA system wrapper — auto-injected by the deployer.
// User handler is in _index.js. Context API and SQS primitives are in fn.js.

"use strict";

const userFn = require("./_index.js");
const {
  buildContext,
  sendInvocation,
  sendResult,
  writeAggState,
  readAggQueue,
  deleteAggMessages,
  emitEvent,
  sqs,
  ENTRY_MAP,
  MY_NAME,
  MY_ENTRY,
  GetQueueUrlCommand,
  ntpSyncPromise,
  now,
  inboxName,
  aggName,
} = require("./fn.js");
const lookup = require("./lookup.json");
const { randomUUID } = require("crypto");

exports.handler = async (event) => {
  await ntpSyncPromise;
  const records = Array.isArray(event && event.Records) ? event.Records : [];

  for (const record of records) {
    let envelope;
    try {
      envelope = JSON.parse(record.body);
    } catch (e) {
      console.error("FLORCA wrapper: malformed SQS message body, skipping:", e);
      continue;
    }
    if (envelope.fn !== undefined) {
      await handleInvocation(envelope);
    } else {
      await handleResumption(envelope);
    }
  }

  return {};
};

// ── Invocation ────────────────────────────────────────────────────────────────

async function handleInvocation(envelope) {
  const { runId, invocationId, payload, returnTo, eventsQueueUrl } = envelope;
  const fanOutId = invocationId + "_fanOut";

  // Recovery detection: inbox queue exists iff a prior Lambda called context.run()
  // before crashing. If found, also check the agg queue for a saved snapshot
  // (only written once the first child result is collected, so may be empty).
  let snapshot = null;
  let aggHandles = [];
  let aggUrl = null;

  let inboxExists = false;
  try {
    await sqs.send(new GetQueueUrlCommand({ QueueName: inboxName(invocationId) }));
    inboxExists = true;
  } catch (e) {
    if (e.name !== "QueueDoesNotExist" && e.__type !== "AWS.SimpleQueueService.NonExistentQueue") throw e;
  }

  if (inboxExists) {
    try {
      const r = await sqs.send(new GetQueueUrlCommand({ QueueName: aggName(invocationId) }));
      aggUrl = r.QueueUrl;
    } catch (e) {
      if (e.name !== "QueueDoesNotExist" && e.__type !== "AWS.SimpleQueueService.NonExistentQueue") throw e;
    }
    if (aggUrl) {
      const r = await readAggQueue(aggUrl, fanOutId, 10);
      snapshot = r.snapshot;
      aggHandles = r.handles;
    }
  }

  // Timeout check: if snapshot is too old, fail instead of replaying.
  if (snapshot) {
    const timeoutMs = (MY_ENTRY && MY_ENTRY.fanOutTimeoutMs) ?? 600000;
    if (now() - snapshot.startedAt > timeoutMs) {
      if (aggUrl) await deleteAggMessages(aggUrl, aggHandles);
      const errObj = { kind: "TimeoutError", message: "Fan-out timed out" };
      await emitEvent(eventsQueueUrl, { runId, type: "function_failed", invocationId, fn: MY_NAME, error: errObj });
      if (returnTo) {
        await sendResult(returnTo, {
          runId, invocationId,
          fanOutId: null, fanOutTotal: null,
          continuationState: envelope.continuationState ?? null,
          callerReturnTo: envelope.callerReturnTo ?? null,
          payload: null, error: errObj,
        });
      } else {
        await emitEvent(eventsQueueUrl, { runId, type: "run_failed", error: errObj });
      }
      return;
    }
  }

  await emitEvent(eventsQueueUrl, {
    runId,
    type: "function_invoked",
    invocationId,
    fn: MY_NAME,
    parentId: envelope.parentId ?? null,
    predecessorId: envelope.predecessorId ?? null,
    input: payload,
  });

  const context = buildContext(envelope, snapshot, userFn);
  const start = Date.now();
  let response;
  try {
    if (snapshot && Array.isArray(snapshot.batches) && snapshot.batches.length > 0) {
      const cbResponse = await context.waitForPendingCallbacks();
      if (cbResponse !== undefined) {
        response = cbResponse;
      }
    } else {
      response = await userFn.handler({ payload, context });
      const cbResponse = await context.waitForPendingCallbacks();
      if (cbResponse !== undefined) {
        response = cbResponse;
      }
    }
  } catch (err) {
    // If the error is a deadline error, let it propagate so the Lambda fails
    // and the ESM re-delivers the invoke message for re-invocation.
    if (err && err.message && err.message.startsWith("FLORCA: deadline reached")) {
      throw err;
    }
    const errObj = { kind: (err && err.name) || "Error", message: (err && err.message) || String(err) };
    await context._cleanup();
    await emitEvent(eventsQueueUrl, { runId, type: "function_failed", invocationId, fn: MY_NAME, error: errObj });
    if (returnTo) {
      await sendResult(returnTo, {
        runId, invocationId,
        fanOutId: envelope.fanOutId ?? null,
        fanOutTotal: envelope.fanOutTotal ?? null,
        continuationState: envelope.continuationState ?? null,
        callerReturnTo: envelope.callerReturnTo ?? null,
        payload: null,
        error: errObj,
      });
    } else {
      await emitEvent(eventsQueueUrl, { runId, type: "run_failed", error: errObj });
    }
    return;
  }

  // Success: clean up agg snapshot before dispatching the response.
  const finalAggUrl = context._aggQueueUrl || aggUrl;
  if (finalAggUrl) {
    const { handles } = await readAggQueue(finalAggUrl, fanOutId, 30);
    await deleteAggMessages(finalAggUrl, handles);
  }
  await context._cleanup();

  await dispatch(response, envelope, eventsQueueUrl, invocationId, Date.now() - start);
}

// ── Resumption (triggered by results-queue ESM for next-chaining) ─────────────

async function handleResumption(resultEnvelope) {
  if (resultEnvelope.isSentinel) return;

  const { continuationState, runId } = resultEnvelope;
  const returnTo = resultEnvelope.callerReturnTo ?? null;

  const invocationEnvelope = {
    continuationState, runId,
    invocationId: randomUUID(),
    returnTo,
    callerReturnTo: null,
    eventsQueueUrl: lookup.eventsQueueUrl,
  };
  await emitEvent(lookup.eventsQueueUrl, {
    runId, type: "function_invoked",
    invocationId: invocationEnvelope.invocationId, fn: MY_NAME,
    parentId: null, predecessorId: null,
    input: resultEnvelope.payload,
  });
  const context = buildContext(invocationEnvelope, null, userFn);
  const start = Date.now();
  let response;
  try {
    response = await userFn.handler({ payload: resultEnvelope.payload, context });
    const cbResponse = await context.waitForPendingCallbacks();
    if (cbResponse !== undefined) {
      response = cbResponse;
    }
  } catch (err) {
    if (err && err.message && err.message.startsWith("FLORCA: deadline reached")) throw err;
    const invocationId = invocationEnvelope.invocationId;
    const errObj = { kind: (err && err.name) || "Error", message: (err && err.message) || String(err) };
    await context._cleanup();
    await emitEvent(lookup.eventsQueueUrl, { runId, type: "function_failed", invocationId, fn: MY_NAME, error: errObj });
    if (returnTo) {
      await sendResult(returnTo, {
        runId, invocationId,
        fanOutId: null, fanOutTotal: null,
        continuationState: null, callerReturnTo: null,
        payload: null, error: errObj,
      });
    } else {
      await emitEvent(lookup.eventsQueueUrl, { runId, type: "run_failed", error: errObj });
    }
    return;
  }

  await context._cleanup();
  await dispatch(response, invocationEnvelope, lookup.eventsQueueUrl, invocationEnvelope.invocationId, Date.now() - start);
}

// ── Dispatch response shape ───────────────────────────────────────────────────

async function dispatch(response, envelope, eventsQueueUrl, invocationId, durationMs) {
  const { runId, returnTo, continuationState } = envelope;

  await emitEvent(eventsQueueUrl, {
    runId, type: "function_completed", invocationId, fn: MY_NAME,
    output: response && response.payload, durationMs,
  });

  if (response && response.next) {
    const nextEntry = ENTRY_MAP[response.next];
    if (!nextEntry) {
      const errObj = { kind: "Error", message: `Unknown function "${response.next}"` };
      if (returnTo) {
        await sendResult(returnTo, {
          runId, invocationId,
          fanOutId: envelope.fanOutId ?? null,
          fanOutTotal: envelope.fanOutTotal ?? null,
          continuationState: envelope.continuationState ?? null,
          callerReturnTo: envelope.callerReturnTo ?? null,
          payload: null, error: errObj,
        });
      } else {
        await emitEvent(eventsQueueUrl, { runId, type: "run_failed", error: errObj });
      }
      return;
    }
    await sendInvocation(nextEntry.invokeQueueUrl, {
      runId,
      invocationId: randomUUID(),
      parentId: null,
      predecessorId: invocationId,
      fn: response.next,
      payload: response.payload,
      continuationState: continuationState ?? null,
      returnTo: returnTo ?? null,
      callerReturnTo: envelope.callerReturnTo ?? null,
      eventsQueueUrl,
      fanOutId: envelope.fanOutId ?? null,
      fanOutTotal: envelope.fanOutTotal ?? null,
    });
    return;
  }

  // Final result.
  if (returnTo) {
    await sendResult(returnTo, {
      runId, invocationId,
      fanOutId: envelope.fanOutId ?? null,
      fanOutTotal: envelope.fanOutTotal ?? null,
      continuationState: continuationState ?? null,
      callerReturnTo: envelope.callerReturnTo ?? null,
      payload: response && response.payload,
      error: null,
    });
  } else {
    await emitEvent(eventsQueueUrl, { runId, type: "run_completed", result: response && response.payload });
  }
}
