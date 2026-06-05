import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const input: number = requestBody.payload ? requestBody.payload : 0;
  const context = requestBody.context;
  const promisedNumber: Promise<number> = new Promise((resolve) => {
    context.onMessage((message: number) => {
      resolve(message);
      return 10;
    });
  });
  const invocation: Promise<number> = context.run("child", input);
  const receivedNumber = await promisedNumber;
  const result = await invocation;
  const sum = receivedNumber + result;
  return {
    payload: `Sum of numbers from child invocation: ${sum}`,
    next: "upper",
  };
};
