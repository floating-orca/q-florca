import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const n: number = requestBody.payload || 1;
  const inputs = Array(n).fill(1);
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
