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
import type { InvokeArgs } from "./invoke_args.ts";
import { getAuthorizationHeader } from "./auth.ts";
import * as env from "./env.ts";
import type { InvocationLogger } from "./invocation_logger.ts";

export const invokeAwsFunction = async (
  entry: LookupEntry,
  invokeArgs: InvokeArgs,
  invocationId: InvocationId,
  invocationLogger: InvocationLogger,
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
      invocationLogger.logEvent("ERROR", message);
      invocationLogger.logEvent("ERROR", logs);
    }
    throw new Error(message);
  } else {
    if (logs) {
      invocationLogger.logEvent("DEBUG", logs);
    }
  }

  return result;
};
