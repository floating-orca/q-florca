import "@std/dotenv/load";
import { invokeAwsFunction } from "./aws.ts";
import { invokeKnFunction } from "./kn.ts";
import type { Payload, ResponseBody } from "@florca/fn";
import type {
  DeploymentName,
  FunctionName,
  InvocationId,
  JsonValue,
  LookupEntry,
  RunId,
} from "@florca/types";
import { invokePluginFunction } from "./plugin.ts";
import { logEvent } from "./mod.ts";

export class FunctionNotFoundError extends Error {
  constructor(functionName: FunctionName) {
    super(`Function '${functionName}' not found`);
    this.name = "FunctionNotFoundError";
  }
}

export type InvokeArgs = {
  runId: RunId;
  deploymentName: DeploymentName;
  deploymentPath: string;
  functionName: FunctionName;
  input: JsonValue;
  params: JsonValue;
  parent: InvocationId | null;
  predecessor: InvocationId | null;
};

type QueuedInvocation = {
  id: InvocationId;
  parent: InvocationId | null;
  predecessor: InvocationId | null;
  runId: RunId;
  functionName: string;
  input: string;
  params: string;
  startTime: string;
  output: string;
  endTime: string;
};

const writeQueue: QueuedInvocation[] = [];

export const run = async (invokeArgs: InvokeArgs): Promise<Payload> => {
  const { runId, deploymentPath, deploymentName } = invokeArgs;
  let { functionName, input, parent, predecessor, params } = invokeArgs;
  while (true) {
    const [id, response] = await invoke({
      runId,
      deploymentName,
      deploymentPath,
      functionName,
      input,
      parent,
      predecessor,
      params,
    });
    const next = response.next;
    if (!next) {
      return response.payload;
    } else if (typeof next === "string") {
      functionName = next;
      input = response.payload;
      params = null;
    } else {
      functionName = Object.keys(next)[0];
      input = response.payload;
      params = next[functionName] ?? null;
    }
    parent = null;
    predecessor = id;
  }
};

const invoke = async (
  invokeArgs: InvokeArgs,
): Promise<[InvocationId, ResponseBody]> => {
  const entry = findLookupEntry(invokeArgs.functionName);
  const invocationId = crypto.randomUUID();
  const startTime = new Date().toISOString();

  logEvent("DEBUG", "Invoking", {
    invocation: invocationId,
    function: invokeArgs.functionName,
    input: invokeArgs.input,
    params: invokeArgs.params,
  });

  let response: ResponseBody;
  if (entry.kind === "aws") {
    response = await invokeAwsFunction(entry, invokeArgs, invocationId);
  } else if (entry.kind === "kn") {
    response = await invokeKnFunction(entry, invokeArgs, invocationId);
  } else if (entry.kind === "plugin") {
    response = await invokePluginFunction(entry, invokeArgs, invocationId);
  } else {
    throw new Error(`Unknown function type: ${entry}`);
  }
  logEvent("INFO", "Completed", {
    invocation: invocationId,
    function: invokeArgs.functionName,
    input: invokeArgs.input,
    params: invokeArgs.params,
    output: response,
  });

  writeQueue.push({
    id: invocationId,
    parent: invokeArgs.parent,
    predecessor: invokeArgs.predecessor,
    runId: invokeArgs.runId,
    functionName: invokeArgs.functionName,
    input: JSON.stringify(invokeArgs.input ?? null),
    params: JSON.stringify(invokeArgs.params ?? null),
    startTime,
    output: JSON.stringify(response),
    endTime: new Date().toISOString(),
  });

  return [invocationId, response];
};

export async function flushWriteQueue(): Promise<void> {
  if (writeQueue.length === 0) return;
  using client = await globalThis.Pool.connect();
  await client.queryArray("begin");
  try {
    const BATCH_SIZE = 1000;
    const PARAMS_COUNT = 10;
    for (let start = 0; start < writeQueue.length; start += BATCH_SIZE) {
      const batch = writeQueue.slice(start, start + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch.map((inv, i) => {
        const base = i * PARAMS_COUNT;
        values.push(
          inv.id,
          inv.parent,
          inv.predecessor,
          inv.runId,
          inv.functionName,
          inv.input,
          inv.params,
          inv.startTime,
          inv.output,
          inv.endTime,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${
          base + 5
        }, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${
          base + 10
        })`;
      });
      await client.queryArray(
        `INSERT INTO invocations (id, parent, predecessor, run_id, function_name, input, params, start_time, output, end_time)
         VALUES ${placeholders.join(", ")}`,
        values,
      );
    }
    await client.queryArray("commit");
  } catch (e) {
    await client.queryArray("rollback");
    throw e;
  }
}

function findLookupEntry(functionName: string): LookupEntry {
  const entry = globalThis.LookupTable.find((f) => f.name === functionName);
  if (!entry) {
    throw new FunctionNotFoundError(functionName);
  }
  return entry;
}
