import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type RequestPayload = any[];

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const elements: RequestPayload = requestBody.payload;
  return {
    payload: elements.join(", "),
  };
};
