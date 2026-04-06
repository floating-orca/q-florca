export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type PluginContext = {
  authorizationHeader: string;
  id: string;
  params: any;
  parentId: string | null;
  workflowMessageUrl: string;
  logEvent: (level: LogLevel, message: string, data?: any) => void;
  onMessage: (fn: ((message: any) => any) | null) => void;
  onWorkflowMessage: (fn: ((message: any) => any) | null) => void;
  run: (functionName: string | any, payload: Payload) => Promise<Payload>;
};

export type RemoteContext = {
  authorizationHeader: string;
  id: string;
  params: any;
  parentId: string | null;
  workflowMessageUrl: string;
};

export type RemoteRequestBody = {
  payload: Payload;
  context: RemoteContext;
};

export type PluginRequestBody = {
  payload: Payload;
  context: PluginContext;
};

export type ResponseBody = {
  payload: Payload;
  next?: Next;
};

export type Payload = any;

export type Next =
  | string
  | { [key: string]: any };

export async function sendMessage(
  message: any,
  receivingInvocation: string | null,
  context: PluginContext,
): Promise<any> {
  let url = context.workflowMessageUrl;
  if (receivingInvocation !== null) {
    url += `/${receivingInvocation}`;
  }
  const response = await fetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: context.authorizationHeader,
      },
      body: JSON.stringify(message),
    },
  );
  return await response.json();
}

export async function sendMessageToParent(
  message: any,
  context: PluginContext,
): Promise<any> {
  const parentId = context.parentId;
  if (parentId === null) {
    throw new Error("No parent to send message to");
  }
  return await sendMessage(message, parentId, context);
}

export async function sendMessageToWorkflow(
  message: any,
  context: PluginContext,
): Promise<any> {
  return await sendMessage(message, null, context);
}
