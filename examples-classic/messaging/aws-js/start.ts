import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type Input = {}; // Define the input type

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const input = requestBody.payload as Input;
  const context = requestBody.context;
  const promise = new Promise((resolve) => {
    context.onMessage((message) => {
      resolve(message);
      return 2;
    });
  });
  const invocation = context.run("child", 1);
  const message = await promise;
  const result = await invocation;
  return {
    payload: message + result,
    next: undefined,
  };
};
