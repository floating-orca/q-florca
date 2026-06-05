import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  // Run a background computation that will take 5 seconds
  const computedValue: Promise<string> = new Promise((resolve) => {
    setTimeout(() => resolve("Some computed value"), 5000);
  });

  // Register a handler for incoming messages
  requestBody.context.onMessage(async (_message) => {
    // Wait for the computation to finish
    return await computedValue;
  });

  // Invoke the child function
  const childInvocation = requestBody.context.run("child", {});

  return {
    // Wait for the child function to finish and return its result
    payload: await childInvocation,
  };
};
