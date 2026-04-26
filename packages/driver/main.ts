import { type Context, Hono } from "@hono/hono";
import type { DriverArgs, InvocationId, InvokeChildArgs } from "@florca/types";
import {
  completeRun,
  gatherLookupEntries,
  reportAvailabilityToEngine,
  runWorkflow,
} from "./lib/mod.ts";
import { Pool } from "@db/postgres";
import { ConsoleLogInvocationLoggerFactory } from "./lib/invocation_logger.ts";
import { ConsoleLogWorkflowLogger } from "./lib/workflow_logger.ts";
import type { InvokeArgs } from "./lib/invoke_args.ts";
import { run } from "./lib/run.ts";
import type { DriverState } from "./lib/driver_state.ts";
import * as env from "./lib/env.ts";

if (Deno.args.length !== 1) {
  throw new Error("Expected exactly one argument");
}
const driverArgs: DriverArgs = JSON.parse(Deno.args[0]);

const POOL_CONNECTIONS = 10;
const databaseUrl = env.getEngineDatabaseUrl();
const pool = new Pool(
  databaseUrl,
  POOL_CONNECTIONS,
  true,
);
const invocationLoggerFactory = new ConsoleLogInvocationLoggerFactory();
const workflowLogger = new ConsoleLogWorkflowLogger();

const driverState: DriverState = {
  lookupTable: await gatherLookupEntries(driverArgs.deploymentPath),
  messageHandlers: new Map(),
  workflowMessageHandler: null,
  pool,
  invocationLoggerFactory,
  workflowLogger,
};

const app = new Hono();

app.post("/invoke", async (c: Context) => {
  const invokeChildArgs: InvokeChildArgs = await c.req.json();
  const invokeArgs: InvokeArgs = {
    runId: driverArgs.runId,
    deploymentName: driverArgs.deploymentName,
    deploymentPath: driverArgs.deploymentPath,
    predecessor: null,
    ...invokeChildArgs,
  };
  const ret = await run(invokeArgs, driverState);
  return c.json(ret);
});

app.post("/", async (c: Context) => {
  const message = await c.req.json();
  const workflowMessageHandler = driverState.workflowMessageHandler;
  let ret = {};
  if (workflowMessageHandler) {
    ret = await workflowMessageHandler(message);
  }
  driverState.workflowLogger.logEvent("DEBUG", "Message", {
    message,
    response: ret,
  });
  return c.json(ret);
});

app.post("/:id", async (c: Context) => {
  const invocationId = c.req.param("id") as InvocationId;
  const message = await c.req.json();
  const messageHandler = driverState.messageHandlers.get(invocationId);
  let ret = {};
  if (messageHandler) {
    ret = await messageHandler(message);
  }
  driverState.workflowLogger.logEvent("DEBUG", "Message", {
    message,
    respondingInvocation: invocationId,
    response: ret,
  });
  return c.json(ret);
});

app.get("/", async (c: Context) => {
  const workflowMessageHandler = driverState.workflowMessageHandler;
  let ret = "No handler registered";
  if (workflowMessageHandler) {
    ret = await workflowMessageHandler({});
  }
  return c.html(ret);
});

app.get("/:id", async (c: Context) => {
  const invocationId = c.req.param("id") as InvocationId;
  const messageHandler = driverState.messageHandlers.get(invocationId);
  let ret = "No handler registered";
  if (messageHandler) {
    ret = await messageHandler({});
  }
  return c.html(ret);
});

const server = Deno.serve(
  {
    port: 0, // Random port
    onListen: (_addr) => {
      // Disables the default "Listening on" message
    },
  },
  app.fetch,
);

await reportAvailabilityToEngine(driverArgs.runId, server.addr.port);

const driverResult = await runWorkflow(driverArgs, driverState);
await completeRun(driverArgs, driverResult);

server.shutdown();

// The following line is to ensure that Deno won't wait for any pending async ops
Deno.exit(0);
