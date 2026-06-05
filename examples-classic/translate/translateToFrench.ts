import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const _input = requestBody.payload;
  // Translate input to French here
  const translation = "Bonjour, le monde!";
  return {
    payload: {
      language: "French",
      translation,
    },
  };
};
