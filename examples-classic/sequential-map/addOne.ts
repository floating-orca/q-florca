import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type RequestPayload = number;

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const reqPayload: RequestPayload = requestBody.payload;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return {
    payload: reqPayload + 1,
  };
};
