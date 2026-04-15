import type {
  DriverArgs,
  DriverResult,
  LookupEntry,
  ReportReadinessRequest,
  RunId,
} from "@florca/types";
import { run } from "./run.ts";
import { resolve } from "@std/path";
import { getPluginFilePath, namesOfShippedPlugins } from "./functions/mod.ts";
import type { DriverState } from "./driver_state.ts";
import { getAuthorizationHeader } from "./auth.ts";
import * as env from "./env.ts";
import type { EventSink } from "./event_sink.ts";

export async function gatherLookupEntries(
  deploymentPath: string,
): Promise<LookupEntry[]> {
  let lookupFunctions: LookupEntry[] = [];

  const workflowPlugins = JSON.parse(
    await Deno.readTextFile(resolve(deploymentPath, "lookup.json")),
  ) as LookupEntry[];
  lookupFunctions = lookupFunctions.concat(workflowPlugins);

  const shippedPlugins = (await namesOfShippedPlugins()).map(
    (name): LookupEntry => ({
      kind: "plugin",
      name,
      location: getPluginFilePath(name),
    }),
  );
  lookupFunctions = lookupFunctions.concat(shippedPlugins);

  return lookupFunctions;
}

export async function reportAvailabilityToEngine(runId: RunId, port: number) {
  const reportReadinessRequest: ReportReadinessRequest = {
    port: port,
    runId: runId,
  };
  const response = await fetch(`${env.getEngineUrl()}/ready`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthorizationHeader(),
    },
    body: JSON.stringify(reportReadinessRequest),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Failed to report driver readiness: ${response.status} ${response.statusText}\n${errorText}`,
    );
  }
}

export async function runWorkflow(
  driverArgs: DriverArgs,
  driverState: DriverState,
): Promise<DriverResult> {
  let driverResult: DriverResult;
  try {
    const result = await run({
      ...driverArgs,
      functionName: driverArgs.entryPoint,
      parent: null,
      predecessor: null,
    }, driverState);
    driverResult = {
      success: {
        value: result,
      },
    };
  } catch (e) {
    if (e instanceof Error) {
      driverResult = {
        error: {
          kind: e.constructor.name,
          message: e.message,
        },
      };
    } else {
      throw e;
    }
  }
  return driverResult;
}

export async function completeRun(
  eventSink: EventSink,
  runId: RunId,
  driverResult: DriverResult,
): Promise<void> {
  // Flush any remaining events before signaling completion
  await eventSink.flush();

  const url = `${env.getEngineUrl()}/${runId}/complete`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: getAuthorizationHeader(),
    },
    body: JSON.stringify(driverResult),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Failed to complete run: ${response.status} ${response.statusText}\n${errorText}`,
    );
  }
}
