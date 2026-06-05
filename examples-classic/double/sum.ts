import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const inputs = requestBody.payload as number[];
  const sum = inputs.reduce((acc, curr) => acc + curr, 0);
  return {
    payload: sum,
  };
};
