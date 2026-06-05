import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  _requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const inputs = [1, 2, 3, 4, 5];
  return {
    payload: inputs,
    next: {
      map: {
        fn: "double",
        reduce: "sum",
      },
    },
  };
};
