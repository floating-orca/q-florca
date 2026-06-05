import type { PluginRequestBody, ResponseBody } from "@florca/fn";

const TIMEOUT = 2000;

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const context = requestBody.context;

  let numberOfBatches = 1;
  let batchSize = 256;

  while (true) {
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Operation timed out"));
        }, TIMEOUT);

        const batches = [...Array(numberOfBatches).keys()];
        const invocations = batches.map((_i) =>
          context.run("compute", batchSize)
        );
        Promise.all(invocations)
          .then(() => resolve())
          .finally(() => clearTimeout(timeout));
      });
      return {
        payload:
          `Finished successfully with ${numberOfBatches} batches of size ${batchSize}`,
      };
    } catch (_error) {
      numberOfBatches *= 2;
      batchSize /= 2;
    }
  }
};
