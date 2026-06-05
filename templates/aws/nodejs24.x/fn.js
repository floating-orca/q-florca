// FLORCA context API + SQS primitives — auto-injected by the deployer.
// User handlers receive a `context` object built by buildContext().
// This module is also available to user code via require('./fn').

"use strict";

const {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
} = require("@aws-sdk/client-sqs");
const { randomUUID, createHash } = require("crypto");
const dgram = require("dgram");
const lookup = require("./lookup.json");

const sqsOptions = {};
if (process.env.AWS_ENDPOINT_URL) {
  sqsOptions.useQueueUrlAsEndpoint = false;
}
const sqs = new SQSClient(sqsOptions);
const ENTRY_MAP = Object.fromEntries(lookup.entries.map((e) => [e.name, e]));

// ── Queue naming ──────────────────────────────────────────────────────────────

// Deterministic invocation IDs encode the full ancestry (`uuid_child_0_child_1…`)
// so they grow with recursion depth and can exceed the SQS queue-name limit
// (80 chars, [A-Za-z0-9_-]). Derive a bounded, deterministic queue name: keep the
// readable form when it fits, otherwise hash the ID to a fixed-width digest so
// arbitrarily deep recursion still produces a valid name. Both the queue owner
// and any sender resolve the same name because this is a pure function of the ID.
function queueName(invocationId, suffix) {
  const base = `${invocationId}-${suffix}`;
  if (base.length <= 80) return base;
  const digest = createHash("sha256").update(invocationId).digest("hex").slice(0, 40);
  return `florca-${digest}-${suffix}`;
}
const inboxName = (invocationId) => queueName(invocationId, "inbox");
const aggName = (invocationId) => queueName(invocationId, "agg");
const MY_NAME = process.env.FLORCA_FUNCTION_NAME;
const MY_ENTRY = ENTRY_MAP[MY_NAME];
// Override in tests to shorten the Lambda deadline so timeout tests run fast.
const LAMBDA_TIMEOUT_MS = parseInt(process.env.FLORCA_LAMBDA_TIMEOUT_MS ?? "870000", 10);

// ── NTP clock sync ────────────────────────────────────────────────────────────

// Offset added to Date.now() so all containers share the same wall-clock reference.
// Computed once per cold start; falls back to 0 (local time) on any error.
let ntpOffset = 0;

function queryNtpTime(host, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    const msg = Buffer.alloc(48);
    msg[0] = 0x1b; // LI=0, VN=3, Mode=3 (client)
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("NTP timeout"));
    }, timeoutMs);
    const sentAt = Date.now();
    socket.send(msg, 0, msg.length, 123, host, (err) => {
      if (err) { clearTimeout(timer); socket.close(); reject(err); }
    });
    socket.on("message", (buf) => {
      clearTimeout(timer);
      socket.close();
      const secs = buf.readUInt32BE(40); // transmit timestamp (seconds since 1900)
      const ntpMs = (secs - 2208988800) * 1000;
      // Correct for one-way latency (assume symmetric round-trip).
      resolve(ntpMs + (Date.now() - sentAt) / 2);
    });
    socket.on("error", (err) => { clearTimeout(timer); socket.close(); reject(err); });
  });
}

// Kick off NTP sync immediately on module load; awaited in the handler before
// any timing decisions are made. Uses the AWS Time Sync Service which is always
// reachable inside Lambda without requiring VPC or internet access.
const ntpSyncPromise = (async () => {
  try {
    const ntpNow = await queryNtpTime("169.254.169.123", 2000);
    ntpOffset = ntpNow - Date.now();
  } catch {
    // Fall back to local time; offset stays 0.
  }
})();

function now() {
  return Date.now() + ntpOffset;
}

// ── Context factory ───────────────────────────────────────────────────────────

// snapshot: pre-loaded agg state from a previous invocation (null on first run).
// Enables the replay model: run() returns cached results without re-dispatching.
function buildContext(envelope, snapshot, userFn) {
  const { continuationState = null } = envelope;

  const fanOutId = envelope.invocationId + "_fanOut";
  const startedAt = (snapshot && snapshot.startedAt) || now();
  const deadline = startedAt + LAMBDA_TIMEOUT_MS;

  // Results from a previous invocation — returned immediately by run() on replay.
  const cachedResults = new Map(Object.entries((snapshot && snapshot.results) || {}));
  // Grows as new results arrive; written to agg queue for crash recovery.
  const resolvedResults = new Map(cachedResults);

  // Deterministic child ID — stable across re-invocations of the same parent.
  let runCounter = 0;

  // Private inbox + agg queues — created lazily on first context.run() call.
  // Each invocation gets its own queues so concurrent parents never compete.
  let inboxQueueUrl = null;
  let aggQueueUrl = null;

  // Store the pending creation promise instead of a simple URL string
  let inboxPromise = null;

  const activeBatches = new Map(); // batchId -> { pending, results[], callbackName, state }
  let batchCounter = 0;
  const pendingPromiseResolvers = [];
  let finalResponse = undefined;
  let cleanupCalled = false;

  async function persistState() {
    if (!aggQueueUrl) return;
    const batchesToSerialize = [];
    for (const [batchId, b] of activeBatches.entries()) {
      batchesToSerialize.push({
        batchId,
        callbackName: b.callbackName,
        state: b.state,
        childIds: b.childIds
      });
    }
    await writeAggState(aggQueueUrl, {
      fanOutId,
      startedAt,
      results: Object.fromEntries(resolvedResults),
      batches: batchesToSerialize
    }).catch((e) => console.error("FLORCA: writeAggState failed:", e));
  }

  if (snapshot && Array.isArray(snapshot.batches)) {
    for (const b of snapshot.batches) {
      const results = new Array(b.childIds.length);
      let pending = 0;
      b.childIds.forEach((childId, idx) => {
        const cached = cachedResults.get(childId);
        if (cached !== undefined) {
          results[idx] = cached.error ? { error: cached.error } : cached.payload;
        } else {
          pending++;
        }
      });
      activeBatches.set(b.batchId, {
        pending,
        results,
        callbackName: b.callbackName,
        state: b.state ?? null,
        childIds: b.childIds
      });
    }
    batchCounter = activeBatches.size;
  }

  let userOnMessageHandler = (userFn && typeof userFn.onMessage === "function") ? userFn.onMessage : null;
  const pendingUserReplies = new Map();

  async function ensureInbox() {
    if (!inboxPromise) {
      inboxPromise = (async () => {
        const [inboxResp, aggResp] = await Promise.all([
          sqs.send(new CreateQueueCommand({ QueueName: inboxName(envelope.invocationId) })),
          sqs.send(new CreateQueueCommand({ QueueName: aggName(envelope.invocationId) })),
        ]);
        aggQueueUrl = aggResp.QueueUrl;
        // Write initial snapshot so re-invocations can detect fanOut timeouts
        // via startedAt, even if no child results have been collected yet.
        if (!snapshot) {
          await persistState();
        }
        return inboxResp.QueueUrl;
      })();
    }
    // All concurrent runs await the exact same creation promise
    inboxQueueUrl = await inboxPromise;
  }

  let pollerRunning = false;

  function ensurePoller() {
    if (pollerRunning) return;
    pollerRunning = true;
    runPoller().catch((err) => {
      console.error("FLORCA: poller error:", err);
    });
  }

  async function processInboxMessage(msg, matchedPromises, matchedCallbacks, toPutBack, callback) {
    let body;
    try {
      body = JSON.parse(msg.Body);
    } catch {
      toPutBack.push(msg);
      return;
    }

    if (body && body.florcaMessageType === "user_reply") {
      await sqs.send(new DeleteMessageCommand({
        QueueUrl: inboxQueueUrl,
        ReceiptHandle: msg.ReceiptHandle,
      })).catch(() => {});
      
      const waiter = pendingUserReplies.get(body.replyToInvocationId);
      if (waiter) {
        pendingUserReplies.delete(body.replyToInvocationId);
        waiter.resolve(body.payload);
      }
    } else if (body && body.florcaMessageType === "user_request") {
      await sqs.send(new DeleteMessageCommand({
        QueueUrl: inboxQueueUrl,
        ReceiptHandle: msg.ReceiptHandle,
      })).catch(() => {});

      if (callback) {
        // Dispatch the handler WITHOUT awaiting it here. Handlers may block on a
        // barrier that only resolves once further messages arrive (e.g. consensus
        // protocols waiting for all participants), so the poller must stay free to
        // keep receiving. The reply is sent whenever the handler eventually settles.
        Promise.resolve(callback(body.payload)).then(async (replyValue) => {
          if (body.senderReturnTo) {
            await sqs.send(new SendMessageCommand({
              QueueUrl: body.senderReturnTo,
              MessageBody: JSON.stringify({
                florcaMessageType: "user_reply",
                replyToInvocationId: body.senderInvocationId,
                payload: replyValue,
              }),
            })).catch((e) => console.error("FLORCA: failed to send reply:", e));
          }
        }).catch((err) => {
          console.error("FLORCA: error in onMessage handler:", err);
        });
      }
    } else {
      const batchId = body.fanOutId;
      const idx = body.fanOutTotal;
      const batchInfo = activeBatches.get(batchId);

      if (batchInfo) {
        matchedCallbacks.push({ msg, result: body, batchId, idx, batchInfo });
      } else {
        toPutBack.push(msg);
      }
    }
  }

  async function runPoller() {
    try {
      while (!cleanupCalled && (activeBatches.size > 0 || userOnMessageHandler !== null || pendingUserReplies.size > 0)) {
        // Check for any already completed batches (e.g. restored from a snapshot)
        for (const [batchId, batchInfo] of activeBatches.entries()) {
          if (batchInfo.pending === 0) {
            activeBatches.delete(batchId);
            const callbackFn = userFn && userFn[batchInfo.callbackName];
            if (callbackFn) {
              try {
                const res = await callbackFn({
                  results: batchInfo.results,
                  state: batchInfo.state,
                  context: ctxObj
                });
                if (res !== undefined) {
                  finalResponse = res;
                  for (const { resolve } of pendingPromiseResolvers) {
                    resolve(res);
                  }
                  pendingPromiseResolvers.length = 0;
                }
              } catch (err) {
                console.error(`FLORCA: Callback "${batchInfo.callbackName}" threw error:`, err);
                for (const { reject } of pendingPromiseResolvers) {
                  reject(err);
                }
                pendingPromiseResolvers.length = 0;
              }
            }
          }
        }

        if (cleanupCalled || !(activeBatches.size > 0 || userOnMessageHandler !== null || pendingUserReplies.size > 0)) {
          break;
        }

        const remaining = Math.ceil((deadline - now()) / 1000);
        if (remaining <= 0) {
          const err = new Error("FLORCA: deadline reached, will be re-invoked");
          for (const { reject } of pendingPromiseResolvers) {
            reject(err);
          }
          pendingPromiseResolvers.length = 0;
          return;
        }

        await ensureInbox();

        let resp;
        try {
          resp = await sqs.send(
            new ReceiveMessageCommand({
              QueueUrl: inboxQueueUrl,
              MaxNumberOfMessages: 10,
              WaitTimeSeconds: Math.min(remaining, 1),
            })
          );
        } catch (err) {
          if (err.__type === "QueueDoesNotExist") break;
          throw err;
        }

        const msgs = resp.Messages || [];
        if (msgs.length > 0 && (cleanupCalled || !(activeBatches.size > 0 || userOnMessageHandler !== null || pendingUserReplies.size > 0))) {
          await Promise.all(msgs.map((msg) =>
            sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: inboxQueueUrl, ReceiptHandle: msg.ReceiptHandle, VisibilityTimeout: 0 })).catch(() => {})
          ));
          break;
        }

        const matchedPromises = [];
        const matchedCallbacks = [];
        const toPutBack = [];

        await Promise.all(
          msgs.map((msg) =>
            processInboxMessage(msg, matchedPromises, matchedCallbacks, toPutBack, userOnMessageHandler)
          )
        );

        await Promise.all([
          ...matchedPromises.map(({ msg }) =>
            sqs.send(new DeleteMessageCommand({
              QueueUrl: inboxQueueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            }))
          ),
          ...matchedCallbacks.map(({ msg }) =>
            sqs.send(new DeleteMessageCommand({
              QueueUrl: inboxQueueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            }))
          ),
          ...toPutBack.map((msg) =>
            sqs.send(new ChangeMessageVisibilityCommand({
              QueueUrl: inboxQueueUrl,
              ReceiptHandle: msg.ReceiptHandle,
              VisibilityTimeout: 0,
            }))
          ),
        ]).catch(() => {});

        for (const { result, waiter } of matchedPromises) {
          // Persist snapshot so re-invocation can replay past this result.
          resolvedResults.set(result.invocationId, result.error
            ? { error: result.error }
            : { payload: result.payload });
          await persistState();

          if (result.error) {
            waiter.reject(new Error(result.error.message || "Child function failed"));
          } else {
            waiter.resolve(result.payload);
          }
        }

        for (const { result, batchId, idx, batchInfo } of matchedCallbacks) {
          batchInfo.results[idx] = result.error ? { error: result.error } : result.payload;
          batchInfo.pending--;

          resolvedResults.set(result.invocationId, result.error
            ? { error: result.error }
            : { payload: result.payload });
          await persistState();

          if (batchInfo.pending === 0) {
            activeBatches.delete(batchId);
            const callbackFn = userFn && userFn[batchInfo.callbackName];
            if (callbackFn) {
              try {
                const res = await callbackFn({
                  results: batchInfo.results,
                  state: batchInfo.state,
                  context: ctxObj
                });
                if (res !== undefined) {
                  finalResponse = res;
                }
              } catch (err) {
                console.error(`FLORCA: Callback "${batchInfo.callbackName}" threw error:`, err);
                for (const { reject } of pendingPromiseResolvers) {
                  reject(err);
                }
                pendingPromiseResolvers.length = 0;
                return;
              }
            } else {
              console.error(`FLORCA: Callback "${batchInfo.callbackName}" not found on module exports`);
            }
          }
        }

        if (activeBatches.size === 0) {
          for (const { resolve } of pendingPromiseResolvers) resolve(finalResponse);
          pendingPromiseResolvers.length = 0;
        }
      }
    } finally {
      pollerRunning = false;
    }
  }

  const ctxObj = {
    id: envelope.invocationId,
    parentId: envelope.parentId ?? null,
    continuationState,
    _fanOutId: fanOutId,
    _startedAt: startedAt,

    abort() {
      activeBatches.clear();
      userOnMessageHandler = null;
      for (const { reject } of pendingPromiseResolvers) {
        reject(new Error("FLORCA: context aborted"));
      }
      pendingPromiseResolvers.length = 0;
    },

    onMessage(callback) {
      userOnMessageHandler = callback;
      if (callback) {
        ensurePoller();
      }
    },

    onWorkflowMessage(callback) {
      // parity
    },

    async run(fnName, payload, callbackName, state) {
      return this.runAll([{ fn: fnName, payload }], callbackName, state);
    },

    async runAll(tasks, callbackName, state) {
      if (!tasks || tasks.length === 0) {
        const callbackFn = userFn && userFn[callbackName];
        if (callbackFn) {
          await callbackFn({ results: [], state, context: this });
        }
        return;
      }

      const batchId = `${envelope.invocationId}_batch_${batchCounter++}`;
      const childIds = [];
      tasks.forEach((task, idx) => {
        childIds.push(`${envelope.invocationId}_child_${runCounter + idx}`);
      });

      const batchInfo = {
        pending: 0,
        results: new Array(tasks.length),
        callbackName,
        state: state ?? null,
        childIds
      };

      const tasksToDispatch = [];

      tasks.forEach((task, idx) => {
        const childInvocationId = childIds[idx];
        runCounter++;
        const cached = cachedResults.get(childInvocationId);

        if (cached !== undefined) {
          batchInfo.results[idx] = cached.error ? { error: cached.error } : cached.payload;
        } else {
          batchInfo.pending++;
          tasksToDispatch.push({ task, idx, childInvocationId });
        }
      });

      if (batchInfo.pending === 0) {
        const callbackFn = userFn && userFn[callbackName];
        if (callbackFn) {
          try {
            const res = await callbackFn({ results: batchInfo.results, state: batchInfo.state, context: this });
            if (res !== undefined) {
              finalResponse = res;
            }
          } catch (err) {
            console.error(`FLORCA: Callback "${callbackName}" threw error:`, err);
            throw err;
          }
        }
        return;
      }

      activeBatches.set(batchId, batchInfo);
      await persistState();

      await ensureInbox();
      ensurePoller();

      await Promise.all(tasksToDispatch.map(async ({ task, idx, childInvocationId }) => {
        const childEntry = ENTRY_MAP[task.fn];
        if (!childEntry) throw new Error(`FLORCA: unknown function "${task.fn}"`);

        await sendInvocation(childEntry.invokeQueueUrl, {
          runId: envelope.runId,
          invocationId: childInvocationId,
          parentId: envelope.invocationId,
          predecessorId: null,
          fn: task.fn,
          payload: task.payload,
          continuationState: null,
          returnTo: inboxQueueUrl,
          callerReturnTo: envelope.returnTo ?? null,
          eventsQueueUrl: envelope.eventsQueueUrl,
          fanOutId: batchId,
          fanOutTotal: idx,
        });
      }));
    },

    async waitForPendingCallbacks() {
      if (activeBatches.size === 0) return finalResponse;
      return new Promise((resolve, reject) => {
        pendingPromiseResolvers.push({ resolve, reject });
      });
    },

    async _cleanup() {
      cleanupCalled = true;
      userOnMessageHandler = null;
      const toDelete = [inboxQueueUrl, aggQueueUrl].filter(Boolean);
      await Promise.all(
        toDelete.map(u => sqs.send(new DeleteQueueCommand({ QueueUrl: u })).catch(() => {}))
      );
      inboxQueueUrl = null;
      aggQueueUrl = null;
    },

    _ensureInbox: ensureInbox,
    _ensurePoller: ensurePoller,
    _pendingUserReplies: pendingUserReplies,
    _envelope: envelope,
    get _inboxQueueUrl() { return inboxQueueUrl; },
    get _aggQueueUrl() { return aggQueueUrl; },
  };

  if (global._florca_active_contexts) {
    global._florca_active_contexts.push(ctxObj);
  }

  if (userOnMessageHandler || activeBatches.size > 0) {
    ensurePoller();
  }

  return ctxObj;
}

// ── SQS primitives (used by index.js) ────────────────────────────────────────

async function sendInvocation(queueUrl, envelope) {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(envelope),
    })
  );
}

async function sendResult(queueUrl, resultEnvelope) {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(resultEnvelope),
    })
  );
}

async function writeAggState(aggregatedQueueUrl, stateObj) {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: aggregatedQueueUrl,
      MessageBody: JSON.stringify(stateObj),
    })
  );
}

async function readAggQueue(aggregatedQueueUrl, fanOutId, visibilityTimeoutSeconds) {
  const handles = [];
  let snapshot = null;

  while (true) {
    const resp = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: aggregatedQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
        VisibilityTimeout: visibilityTimeoutSeconds,
      })
    );
    const msgs = resp.Messages || [];
    if (msgs.length === 0) break;
    for (const msg of msgs) {
      let obj;
      try { obj = JSON.parse(msg.Body); } catch { continue; }
      if (obj.fanOutId !== fanOutId) {
        await sqs.send(new ChangeMessageVisibilityCommand({
          QueueUrl: aggregatedQueueUrl,
          ReceiptHandle: msg.ReceiptHandle,
          VisibilityTimeout: 0,
        }));
        continue;
      }
      handles.push(msg.ReceiptHandle);
      const count = obj.results ? Object.keys(obj.results).length : 0;
      const best = snapshot ? Object.keys(snapshot.results || {}).length : -1;
      if (count > best) snapshot = obj;
    }
  }

  return { snapshot, handles };
}

async function deleteAggMessages(aggregatedQueueUrl, handles) {
  for (let i = 0; i < handles.length; i += 10) {
    const batch = handles.slice(i, i + 10).map((h, j) => ({ Id: String(j), ReceiptHandle: h }));
    await sqs.send(new DeleteMessageBatchCommand({ QueueUrl: aggregatedQueueUrl, Entries: batch }));
  }
}

async function emitEvent(queueUrl, event) {
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: queueUrl || lookup.eventsQueueUrl,
        MessageBody: JSON.stringify({ ts: Date.now(), ...event }),
      })
    );
  } catch (e) {
    console.error("FLORCA: failed to emit event:", e);
  }
}

/**
 * @param {any} message
 * @param {string|null} receivingInvocation
 * @param {any} context
 * @returns {Promise<any>}
 */
async function sendMessage(message, receivingInvocation, context) {
  if (!receivingInvocation) {
    throw new Error("FLORCA: SQS sendMessage requires a receivingInvocation ID");
  }

  await context._ensureInbox();

  const myReturnTo = context._envelope.returnTo || context._inboxQueueUrl;
  if (!myReturnTo) {
    throw new Error("FLORCA: Cannot determine return address for SQS request-reply");
  }
  const prefix = myReturnTo.substring(0, myReturnTo.lastIndexOf("/") + 1);
  const targetInboxUrl = prefix + inboxName(receivingInvocation);

  const requestId = randomUUID();

  const replyPromise = new Promise((resolve, reject) => {
    context._pendingUserReplies.set(requestId, { resolve, reject });
  });

  context._ensurePoller();

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: targetInboxUrl,
      MessageBody: JSON.stringify({
        florcaMessageType: "user_request",
        senderInvocationId: requestId,
        senderReturnTo: context._inboxQueueUrl,
        payload: message,
      }),
    })
  );

  return await replyPromise;
}

/**
 * @param {any} message
 * @param {any} context
 * @returns {Promise<any>}
 */
async function sendMessageToParent(message, context) {
  const parentId = context.parentId;
  if (parentId === null) {
    throw new Error("No parent to send message to");
  }
  return await sendMessage(message, parentId, context);
}

/**
 * @param {any} message
 * @param {any} context
 * @returns {Promise<any>}
 */
async function sendMessageToWorkflow(message, context) {
  return await sendMessageToParent(message, context);
}

module.exports = {
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
  sendMessageToParent,
  sendMessageToWorkflow,
  GetQueueUrlCommand,
  ntpSyncPromise,
  now,
  inboxName,
  aggName,
};

