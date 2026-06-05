import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const inputs = [1, 2, 3, 4, 5];
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
