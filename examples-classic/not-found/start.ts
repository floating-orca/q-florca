import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  _requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  return {
    payload: "Hello, world!",
    next: "nonExistentFunction",
  };
};
