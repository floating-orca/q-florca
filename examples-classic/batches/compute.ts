import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const batchSize: number = requestBody.payload;
  const duration = batchSize ** 2;
  await new Promise((resolve) => setTimeout(resolve, duration));
  return {
    payload: {},
  };
};
