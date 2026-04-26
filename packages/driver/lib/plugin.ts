// deno-lint-ignore-file no-explicit-any

import "@std/dotenv/load";
import { resolve } from "@std/path";
import type {
  LogLevel,
  Payload,
  PluginRequestBody,
  ResponseBody,
} from "@florca/fn";
import type { InvocationId, LookupEntry } from "@florca/types";
import type { InvokeArgs } from "./invoke_args.ts";
import { run } from "./run.ts";
import type { DriverState } from "./driver_state.ts";
import { getAuthorizationHeader } from "./auth.ts";
import * as env from "./env.ts";

export async function invokePluginFunction(
  entry: LookupEntry,
  invokeArgs: InvokeArgs,
  invocationId: InvocationId,
  driverState: DriverState,
): Promise<ResponseBody> {
  const invocationLogger = driverState.invocationLoggerFactory.forInvocation(
    invocationId,
    invokeArgs.functionName,
  );
  const plugin = await import(
    resolve(invokeArgs.deploymentPath, entry.location)
  );
  const body: PluginRequestBody = {
    payload: invokeArgs.input,
    context: {
      authorizationHeader: getAuthorizationHeader(),
      id: invocationId,
      params: invokeArgs.params,
      parentId: invokeArgs.parent,
      workflowMessageUrl: `${env.getEngineUrl()}/${invokeArgs.runId}`,
      logEvent: (level: LogLevel, message: string, data?: any) => {
        invocationLogger.logEvent(level, message, data);
      },
      onMessage: (fn: ((message: any) => void) | null) => {
        if (fn) {
          driverState.messageHandlers.set(invocationId, fn);
        } else {
          driverState.messageHandlers.delete(invocationId);
        }
      },
      onWorkflowMessage: (fn: ((message: any) => void) | null) => {
        driverState.workflowMessageHandler = fn;
      },
      run: (fn: string | any, payload: Payload) => {
        let functionName;
        let params;
        if (typeof fn === "string") {
          functionName = fn;
        } else {
          functionName = Object.keys(fn)[0];
          params = fn[functionName];
        }
        const runArgs: InvokeArgs = {
          runId: invokeArgs.runId,
          deploymentName: invokeArgs.deploymentName,
          deploymentPath: invokeArgs.deploymentPath,
          functionName,
          input: payload,
          params: params ?? null,
          parent: invocationId,
          predecessor: null,
        };
        return run(runArgs, driverState);
      },
    },
  };
  const response = await plugin.default(body);
  return response;
}
