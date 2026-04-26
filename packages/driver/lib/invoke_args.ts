import type {
  DeploymentName,
  FunctionName,
  InvocationId,
  JsonValue,
  RunId,
} from "@florca/types";

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
