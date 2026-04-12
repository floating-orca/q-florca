import type { RemoteRequestBody, ResponseBody } from "@florca/fn";
import type { InvocationId, LookupEntry } from "@florca/types";
import type { InvokeArgs } from "./run.ts";
import { getAuthorizationHeader } from "./auth.ts";
import * as env from "./env.ts";

export const invokeKnFunction = async (
  entry: LookupEntry,
  invokeArgs: InvokeArgs,
  invocationId: InvocationId,
): Promise<ResponseBody> => {
  const baseUrl = entry.location;
  const funcPort = env.getKnFuncPort();
  const url = `${baseUrl}:${funcPort}`;

  const funcBasicAuth = env.getKnFuncBasicAuth();

  const body: RemoteRequestBody = {
    payload: invokeArgs.input,
    context: {
      authorizationHeader: getAuthorizationHeader(),
      id: invocationId,
      params: invokeArgs.params,
      parentId: invokeArgs.parent,
      workflowMessageUrl:
        `${env.getEngineUrlForAccessFromKn()}/${invokeArgs.runId}`,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: funcBasicAuth ? `Basic ${funcBasicAuth}` : "",
    },
    body: JSON.stringify(body),
  });

  return await response.json();
};
