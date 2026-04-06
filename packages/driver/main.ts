import { type Context, Hono } from "@hono/hono";
import type {
  DriverArgs,
  InvocationId,
  InvokeChildArgs,
  LookupEntry,
} from "@florca/types";
import {
  gatherLookupEntries,
  logEvent,
  reportAvailabilityToEngine,
  runWorkflow,
} from "./lib/mod.ts";
import { type InvokeArgs, run } from "./lib/run.ts";
import { Pool } from "@db/postgres";

declare global {
  var LookupTable: LookupEntry[];
  // deno-lint-ignore no-explicit-any
  var MessageHandlers: Map<InvocationId, (message: any) => any>;
  // deno-lint-ignore no-explicit-any
  var WorkflowMessageHandler: ((message: any) => any) | null | undefined;
  var Pool: Pool;
}

if (Deno.args.length !== 1) {
  throw new Error("Expected exactly one argument");
}
const driverArgs: DriverArgs = JSON.parse(Deno.args[0]);

globalThis.LookupTable = await gatherLookupEntries(driverArgs.deploymentPath);
globalThis.MessageHandlers = new Map();

const POOL_CONNECTIONS = 10;
const databaseUrl = Deno.env.get("ENGINE_DATABASE_URL");
if (!databaseUrl) {
  throw new Error("ENGINE_DATABASE_URL environment variable must be set");
}
globalThis.Pool = new Pool(
  databaseUrl,
  POOL_CONNECTIONS,
  true,
);

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
  const ret = await run(invokeArgs);
  return c.json(ret);
});

app.post("/", async (c: Context) => {
  const message = await c.req.json();
  const workflowMessageHandler = globalThis.WorkflowMessageHandler;
  let ret = {};
  if (workflowMessageHandler) {
    ret = await workflowMessageHandler(message);
  }
  logEvent("DEBUG", "Message", {
    message,
    response: ret,
  });
  return c.json(ret);
});

app.post("/:id", async (c: Context) => {
  const invocationId = c.req.param("id") as InvocationId;
  const message = await c.req.json();
  const messageHandler = globalThis.MessageHandlers.get(invocationId);
  let ret = {};
  if (messageHandler) {
    ret = await messageHandler(message);
  }
  logEvent("DEBUG", "Message", {
    message,
    respondingInvocation: invocationId,
    response: ret,
  });
  return c.json(ret);
});

app.get("/", async (c: Context) => {
  const workflowMessageHandler = globalThis.WorkflowMessageHandler;
  let ret = "No handler registered";
  if (workflowMessageHandler) {
    ret = await workflowMessageHandler({});
  }
  return c.html(ret);
});

app.get("/:id", async (c: Context) => {
  const invocationId = c.req.param("id") as InvocationId;
  const messageHandler = globalThis.MessageHandlers.get(invocationId);
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

const driverResult = await runWorkflow(driverArgs);

await Deno.writeTextFile(
  driverArgs.outfilePath,
  JSON.stringify(driverResult),
);

server.shutdown();

// The following line is to ensure that Deno won't wait for any pending async ops
Deno.exit(0);
