import type { PluginRequestBody, ResponseBody } from "@florca/fn";

const NUMBER_OF_CHILDREN = 5;

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { context } = requestBody;

  // Collect the IDs of the sibling invocations.
  // Only respond once all IDs have been collected.
  const ids: string[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  context.onMessage(async (id) => {
    ids.push(id);
    if (ids.length === NUMBER_OF_CHILDREN) {
      resolve();
    }
    await promise;
    return ids;
  });

  // Invoke the sibling function NUMBER_OF_CHILDREN times
  const invocations: Promise<string>[] = [...Array(NUMBER_OF_CHILDREN).keys()]
    .map((i) => context.run("sibling", i));

  // Wait for all invocations to complete
  const results = await Promise.all(invocations);

  return {
    payload: results,
  };
};
