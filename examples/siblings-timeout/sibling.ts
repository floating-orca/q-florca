import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { sendMessage, sendMessageToParent } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { context, payload: { i, delay } } = requestBody;

  // Simulate a delay on even-numbered invocations
  if (i % 2 === 0) {
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  }

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

  // Simulate a delay on odd-numbered invocations
  if (i % 2 === 1) {
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
  }

  // Filter out the ID of the current invocation
  ids = ids.filter((id) => id !== context.id);

  // Send this invocation's ID to each sibling
  await Promise.all(ids.map((id) => sendMessage(i, id, context)));

  // Wait for all sibling invocations to send their numbers
  const numbers = (await messages).map((message) => parseInt(message));

  // Uncomment the following line to test the parent's timeout
  await new Promise((resolve) => { setTimeout(resolve, delay); });

  return {
    // Sum the received numbers and return the result
    payload: numbers.reduce((sum, number) => sum + number, 0),
  };
};
