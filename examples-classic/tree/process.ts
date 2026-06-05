import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const context = requestBody.context;

  const { promise: files, resolve } = Promise.withResolvers<string[]>();

  // No function invocations and no results at the beginning.
  const invocations: Promise<string[]>[] = [];
  const results: string[][] = [];

  // Define a function that invokes the processNode function for a given path.
  // Once the invocation is resolved, its result is added to the results array.
  // If the resolved invocation is the last one, the files promise is resolved with the results array flattened.
  const invokeProcessNode = (path: string) => {
    const invocation: Promise<string[]> = context.run("processNode", { path });
    invocations.push(invocation);
    invocation.then((result) => {
      results.push(result);
      if (results.length === invocations.length) {
        resolve(results.flat());
      }
    });
  };

  // Register a handler for incoming messages.
  // When a message is received, the processNode function is invoked for each path in the message.
  context.onMessage((paths: string[]) => {
    for (const path of paths) {
      invokeProcessNode(path);
    }
  });

  // Start the process by invoking the processNode function for the root path.
  invokeProcessNode("/");

  return {
    payload: await files,
  };
};
