import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  _requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  return {
    payload: 5,
    // next: "plusThree",
    next: "plusFour",
  };
};
