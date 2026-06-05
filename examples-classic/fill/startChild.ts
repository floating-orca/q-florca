import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const n: number = requestBody.payload || 1;
  const inputs = Array(n).fill(1);
  const result = await requestBody.context.run({
    map: {
      fn: "double",
      reduce: "sum",
    },
  }, inputs);
  return {
    payload: result,
  };
};
