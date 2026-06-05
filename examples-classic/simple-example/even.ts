import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const input = requestBody.payload;
  return {
    payload: `The number ${input} is even.`,
  };
};
