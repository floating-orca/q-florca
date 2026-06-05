import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  throw new Error("What a terrible failure!");
  return {
    payload: requestBody.payload,
    next: "unreachable",
  };
};
