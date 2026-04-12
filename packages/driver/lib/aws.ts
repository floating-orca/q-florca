import type { RemoteRequestBody, ResponseBody } from "@florca/fn";
import {
  InvokeCommand,
  type InvokeCommandInput,
  type InvokeCommandOutput,
  LambdaClient,
  LogType,
} from "@aws-sdk/client-lambda";
import { Buffer } from "node:buffer";
import type { InvocationId, LookupEntry } from "@florca/types";
import type { InvokeArgs } from "./run.ts";
import { logEvent } from "./mod.ts";
import { getAuthorizationHeader } from "./auth.ts";
import * as env from "./env.ts";

export const invokeAwsFunction = async (
  entry: LookupEntry,
  invokeArgs: InvokeArgs,
  invocationId: InvocationId,
): Promise<ResponseBody> => {
  const arn = entry.location;
  const body: RemoteRequestBody = {
    payload: invokeArgs.input,
    context: {
      authorizationHeader: getAuthorizationHeader(),
      id: invocationId,
      params: invokeArgs.params,
      parentId: invokeArgs.parent,
      workflowMessageUrl: `${env.getEngineUrl()}/${invokeArgs.runId}`,
    },
  };

  const region = arn.split(":")[3];
  const client = new LambdaClient({ region });

  const input: InvokeCommandInput = {
    FunctionName: arn,
    InvocationType: "RequestResponse",
    LogType: LogType.Tail,
    Payload: new TextEncoder().encode(JSON.stringify(body)),
  };
  const command = new InvokeCommand(input);

  logEvent("DEBUG", "Invoking AWS Lambda function", arn);
  const response: InvokeCommandOutput = await client.send(command);
  const { FunctionError, Payload, LogResult, StatusCode } = response;

  if (StatusCode !== 200) {
    throw new Error(
      `AWS Lambda function ${arn} failed with status code: ${StatusCode}`,
    );
  }

  const textDecoder = new TextDecoder();
  const result = JSON.parse(textDecoder.decode(Payload));

  let logs: string | undefined;
  if (LogResult) {
    logs = Buffer.from(LogResult, "base64").toString();
  }

  if (FunctionError) {
    const message =
      `AWS Lambda function ${arn} failed with error: ${FunctionError}`;
    if (logs) {
      logEvent("ERROR", message);
      logEvent("ERROR", logs);
    }
    throw new Error(message);
  } else {
    if (logs) {
      logEvent("DEBUG", logs);
    }
  }

  return result;
};
