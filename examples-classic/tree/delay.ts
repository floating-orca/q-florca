import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return {
    payload: requestBody.payload.payload,
    next: requestBody.payload.next,
  };
};
