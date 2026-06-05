import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const _input = requestBody.payload;
  // Translate input to German here
  const translation = "Hallo, Welt!";
  return {
    payload: {
      language: "German",
      translation,
    },
  };
};
