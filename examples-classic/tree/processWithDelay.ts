import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const context = requestBody.context;

  // Pass `-i '{ "onAws": true }'` to the CLI to invoke processNodeOnAws instead of processNode.
  const fn = requestBody.payload?.onAws === true
    ? "processNodeOnAws"
    : "processNode";

  const promises: Promise<any>[] = [];
  let resolved = 0;

  const runProcessNode = (path: string) => {
    const promise = context.run("delay", {
      next: fn,
      payload: { path, invocationToMessage: context.id },
    });
    promises.push(promise);
    promise.then(() => {
      resolved++;
    });
  };

  context.onMessage((paths: string[]) => {
    for (const path of paths) {
      runProcessNode(path);
    }
  });

  runProcessNode("/");

  while (resolved < promises.length) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const results = await Promise.all(promises);
  return {
    payload: results.flat(),
  };
};
