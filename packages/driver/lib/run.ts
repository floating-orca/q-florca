import "@std/dotenv/load";
import { invokeAwsFunction } from "./aws.ts";
import { invokeKnFunction } from "./kn.ts";
import type { Payload, ResponseBody } from "@florca/fn";
import type {
  DriverEvent,
  FunctionName,
  InvocationId,
  LookupEntry,
} from "@florca/types";
import type { InvokeArgs } from "./invoke_args.ts";
import { invokePluginFunction } from "./plugin.ts";
import type { DriverState } from "./driver_state.ts";

export class FunctionNotFoundError extends Error {
  constructor(functionName: FunctionName) {
    super(`Function '${functionName}' not found`);
    this.name = "FunctionNotFoundError";
  }
}

export const run = async (
  invokeArgs: InvokeArgs,
  driverState: DriverState,
): Promise<Payload> => {
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
    }, driverState);
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
  driverState: DriverState,
): Promise<[InvocationId, ResponseBody]> => {
  const entry = findLookupEntry(
    invokeArgs.functionName,
    driverState.lookupTable,
  );
  const invocationId = crypto.randomUUID();
  const invocationLogger = driverState.invocationLoggerFactory.forInvocation(
    invocationId,
    invokeArgs.functionName,
  );
  const startTime = Temporal.Now.instant().toString();

  invocationLogger.logEvent("DEBUG", "Invocation start", {
    input: invokeArgs.input,
    params: invokeArgs.params,
  });

  try {
    let response: ResponseBody;
    if (entry.kind === "aws") {
      response = await invokeAwsFunction(
        entry,
        invokeArgs,
        invocationId,
        invocationLogger,
      );
    } else if (entry.kind === "kn") {
      response = await invokeKnFunction(entry, invokeArgs, invocationId);
    } else if (entry.kind === "plugin") {
      response = await invokePluginFunction(
        entry,
        invokeArgs,
        invocationId,
        driverState,
      );
    } else {
      throw new Error(`Unknown function type: ${entry}`);
    }

    const endTime = Temporal.Now.instant().toString();
    const event: DriverEvent = newSuccessEvent(
      invocationId,
      invokeArgs,
      response,
      startTime,
      endTime,
    );
    driverState.eventSink.addEvent(event);

    return [invocationId, response];
  } catch (e) {
    if (e instanceof Error) {
      const error = {
        kind: e.constructor.name,
        message: e.message,
      };
      const failureEvent: DriverEvent = newFailureEvent(
        invocationId,
        invokeArgs,
        startTime,
        error,
      );
      driverState.eventSink.addEvent(failureEvent);
    }

    throw e;
  }
};

function newSuccessEvent(
  invocationId: InvocationId,
  invokeArgs: InvokeArgs,
  response: ResponseBody,
  startTime: string,
  endTime: string,
): DriverEvent {
  return {
    type: "invocationSuccess",
    id: invocationId,
    parent: invokeArgs.parent,
    predecessor: invokeArgs.predecessor,
    functionName: invokeArgs.functionName,
    input: invokeArgs.input ?? null,
    params: invokeArgs.params ?? null,
    output: response ?? null,
    startTime,
    endTime,
  };
}

function newFailureEvent(
  invocationId: InvocationId,
  invokeArgs: InvokeArgs,
  startTime: string,
  error: { kind: string; message: string },
): DriverEvent {
  return {
    type: "invocationFailure",
    id: invocationId,
    parent: invokeArgs.parent,
    predecessor: invokeArgs.predecessor,
    functionName: invokeArgs.functionName,
    input: invokeArgs.input ?? null,
    params: invokeArgs.params ?? null,
    startTime,
    error,
  };
}

function findLookupEntry(
  functionName: string,
  lookupTable: LookupEntry[],
): LookupEntry {
  const entry = lookupTable.find((f) => f.name === functionName);
  if (!entry) {
    throw new FunctionNotFoundError(functionName);
  }
  return entry;
}
