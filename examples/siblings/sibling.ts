import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { sendMessage, sendMessageToParent } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { context, payload } = requestBody;

  let ids: string[];

  // Configure a handler to collect the messages from the sibling invocations
  const messages: Promise<string[]> = new Promise((resolve) => {
    const messages: string[] = [];
    context.onMessage((message) => {
      messages.push(message);
      if (messages.length === ids.length) {
        resolve(messages);
      }
    });
  });

  // Ask parent for the IDs of the sibling invocations while sending the current
  // invocation's ID
  ids = await sendMessageToParent(context.id, context);

  // Filter out the ID of the current invocation
  ids = ids.filter((id) => id !== context.id);

  // Send this invocation's ID to each sibling
  await Promise.all(ids.map((id) => sendMessage(payload, id, context)));

  // Wait for all sibling invocations to send their numbers
  const numbers = (await messages).map((message) => parseInt(message));

  return {
    // Sum the received numbers and return the result
    payload: numbers.reduce((sum, number) => sum + number, 0),
  };
};
