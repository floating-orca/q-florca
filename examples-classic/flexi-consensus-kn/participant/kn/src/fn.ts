export async function sendMessage(
  message: any,
  receivingInvocation: number | null,
  context: any,
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
  context: any,
): Promise<any> {
  const parentId = context.parentId;
  if (parentId === null) {
    throw new Error("No parent to send message to");
  }
  return await sendMessage(message, parentId, context);
}

export async function sendMessageToWorkflow(
  message: any,
  context: any,
): Promise<any> {
  return await sendMessage(message, null, context);
}
