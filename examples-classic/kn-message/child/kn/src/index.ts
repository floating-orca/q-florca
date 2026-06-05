import { sendMessage, sendMessageToParent, sendMessageToWorkflow } from "./fn";

type Input = number;

export const handle = async (
  _: unknown,
  requestBody: any,
): Promise<unknown> => {
  const input: Input = requestBody.payload;
  const context = requestBody.context;
  const response = await sendMessageToParent(100, context);
  const result = input + response;
  return {
    body: {
      payload: result,
      next: undefined,
    },
    headers: {
      "Content-Type": "application/json",
    },
  };
};
