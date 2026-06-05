"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const {
  SQSClient,
  CreateQueueCommand,
  DeleteQueueCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueUrlCommand,
} = require("@aws-sdk/client-sqs");

const HANDLER_DIR = path.join(__dirname, "..");
const ENDPOINT = process.env.LOCALSTACK_ENDPOINT || "http://localhost:4566";
const REGION = "us-east-1";

function makeSqs() {
  return new SQSClient({
    endpoint: ENDPOINT,
    region: REGION,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    useQueueUrlAsEndpoint: false,
  });
}

async function createQueue(sqs, name, fifo = false) {
  const attrs = fifo
    ? { FifoQueue: "true", ContentBasedDeduplication: "false" }
    : {};
  const resp = await sqs.send(
    new CreateQueueCommand({ QueueName: name, Attributes: attrs })
  );
  return resp.QueueUrl;
}

async function deleteQueue(sqs, url) {
  try {
    await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
  } catch {
    // best-effort cleanup
  }
}

// Creates the invoke queue for one function.
// The per-invocation agg queue is created dynamically by the wrapper on first context.run().
async function createFunctionQueues(sqs, prefix) {
  const invokeQueueUrl = await createQueue(sqs, `${prefix}-invoke`);
  return { invokeQueueUrl };
}

// Loads the Lambda handler into an isolated temp directory so each test has
// its own module instances (avoiding require-cache cross-contamination).
// userFn must be provided upfront because index.js requires _index.js at load time.
function loadHandler(fnName, lookup, userFn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "florca-test-"));
  fs.copyFileSync(path.join(HANDLER_DIR, "fn.js"), path.join(tmpDir, "fn.js"));
  fs.copyFileSync(
    path.join(HANDLER_DIR, "index.js"),
    path.join(tmpDir, "index.js")
  );
  fs.writeFileSync(path.join(tmpDir, "lookup.json"), JSON.stringify(lookup));
  // Make @aws-sdk/client-sqs resolvable from the temp dir.
  fs.symlinkSync(
    path.join(__dirname, "node_modules"),
    path.join(tmpDir, "node_modules")
  );
  // _index.js must exist before require("./index.js") runs.
  fs.writeFileSync(
    path.join(tmpDir, "_index.js"),
    `"use strict";\nmodule.exports = { handler: ${userFn.toString()} };\n`
  );
  // Env vars are read at module-load time by fn.js.
  process.env.FLORCA_FUNCTION_NAME = fnName;
  process.env.AWS_ENDPOINT_URL = ENDPOINT;
  process.env.AWS_ACCESS_KEY_ID = "test";
  process.env.AWS_SECRET_ACCESS_KEY = "test";
  process.env.AWS_REGION = REGION;

  const { handler } = require(path.join(tmpDir, "index.js"));
  return handler;
}

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



// Build an SQS Records event as the ESM would deliver it.
function makeInvokeEvent(envelope) {
  return {
    Records: [
      {
        messageId: randomUUID(),
        receiptHandle: "test-receipt",
        body: JSON.stringify(envelope),
        attributes: {},
        messageAttributes: {},
        md5OfBody: "",
        eventSource: "aws:sqs",
        eventSourceARN: "",
        awsRegion: REGION,
      },
    ],
  };
}

// Drive N real Lambda invocations from invokeQueueUrl.
// Polls the queue, constructs a real SQS Records event, calls handler (which
// exercises the full handleInvocation → dispatch → sendResult path), then
// deletes the message — simulating ESM success deletion.
async function driveHandler(sqs, invokeQueueUrl, handler, count) {
  let processed = 0;
  while (processed < count) {
    const resp = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: invokeQueueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 5,
      })
    );
    const msg = resp.Messages?.[0];
    if (!msg) continue;

    try {
      await handler({
        Records: [{
          messageId: randomUUID(),
          receiptHandle: msg.ReceiptHandle,
          body: msg.Body,
          attributes: {},
          messageAttributes: {},
          md5OfBody: "",
          eventSource: "aws:sqs",
          eventSourceARN: "",
          awsRegion: REGION,
        }],
      });
    } catch (err) {
      const errStr = String(err);
      if (
        err.name === "QueueDoesNotExist" ||
        err.code === "AWS.SimpleQueueService.NonExistentQueue" ||
        err.Code === "AWS.SimpleQueueService.NonExistentQueue" ||
        errStr.includes("QueueDoesNotExist") ||
        errStr.includes("NonExistentQueue") ||
        errStr.includes("does not exist")
      ) {
        // Parent inbox queue was already deleted (parent completed or crashed).
        // This is expected and safe in integration tests, so we ignore it.
      } else {
        throw err;
      }
    }

    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: invokeQueueUrl, ReceiptHandle: msg.ReceiptHandle })
    );
    processed++;
  }
}

// Poll eventsQueueUrl until predicate(event) returns true, or timeout.
async function waitForEvent(sqs, eventsQueueUrl, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    const resp = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: eventsQueueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: Math.min(remaining, 2),
      })
    );
    const msgs = resp.Messages || [];
    let matched = null;
    await Promise.all(
      msgs.map(async (msg) => {
        const ev = JSON.parse(msg.Body);
        if (!matched && predicate(ev)) {
          matched = ev;
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: eventsQueueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            })
          );
          return;
        }

        // Delete auxiliary events that are never waited for, keeping the queue clean.
        if (ev.type !== "run_completed" && ev.type !== "function_failed") {
          await sqs.send(
            new DeleteMessageCommand({
              QueueUrl: eventsQueueUrl,
              ReceiptHandle: msg.ReceiptHandle,
            })
          );
          return;
        }

        // Put back unmatched target events for concurrent pollers after a brief delay to prevent hot-polling loops.
        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: eventsQueueUrl,
            ReceiptHandle: msg.ReceiptHandle,
            VisibilityTimeout: 2,
          })
        );
      })
    );
    if (matched) return matched;
  }
  throw new Error(`Expected event not received within ${timeoutMs}ms`);
}

// Poll eventsQueueUrl until a run_completed event for runId appears, or timeout.
async function waitForRunCompleted(sqs, eventsQueueUrl, runId, timeoutMs = 30000) {
  return waitForEvent(
    sqs,
    eventsQueueUrl,
    (ev) => ev.type === "run_completed" && ev.runId === runId,
    timeoutMs
  );
}

// Read one message without deleting it (put back with VisibilityTimeout=0).
async function peekQueue(sqs, queueUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waitSecs = Math.min(Math.ceil((deadline - Date.now()) / 1000), 5);
    if (waitSecs <= 0) break;
    const resp = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: waitSecs,
      })
    );
    const msg = resp.Messages?.[0];
    if (!msg) continue;
    await sqs.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: msg.ReceiptHandle,
        VisibilityTimeout: 0,
      })
    );
    return JSON.parse(msg.Body);
  }
  throw new Error(`No message to peek at in queue within ${timeoutMs}ms`);
}

// Poll a queue until one message arrives, delete it, and return the parsed body.
async function pollQueue(sqs, queueUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waitSecs = Math.min(Math.ceil((deadline - Date.now()) / 1000), 5);
    if (waitSecs <= 0) break;
    const resp = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: waitSecs,
      })
    );
    const msg = resp.Messages?.[0];
    if (!msg) continue;
    await sqs.send(
      new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle })
    );
    return JSON.parse(msg.Body);
  }
  throw new Error(`No message in queue within ${timeoutMs}ms`);
}

// Drain all messages from a queue (for asserting emptiness).
async function drainQueue(sqs, queueUrl) {
  const messages = [];
  while (true) {
    const resp = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      })
    );
    if (!resp.Messages?.length) break;
    messages.push(...resp.Messages.map((m) => JSON.parse(m.Body)));
    await Promise.all(
      resp.Messages.map((m) =>
        sqs.send(
          new DeleteMessageCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: m.ReceiptHandle,
          })
        )
      )
    );
  }
  return messages;
}

// Peek the per-invocation agg queue ({invocationId}-agg).
// Returns null if the queue doesn't exist yet or has no messages.
// Test invocation IDs are short UUIDs, so the plain name always matches the
// runtime's queueName() helper (which only hashes IDs that would exceed 80 chars).
async function peekInvocationAggQueue(sqs, invocationId) {
  let queueUrl;
  try {
    const r = await sqs.send(new GetQueueUrlCommand({ QueueName: `${invocationId}-agg` }));
    queueUrl = r.QueueUrl;
  } catch {
    return null;
  }
  return peekQueue(sqs, queueUrl, 500).catch(() => null);
}

module.exports = {
  makeSqs,
  createQueue,
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
  pollQueue,
  drainQueue,
  randomUUID,
};
