import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  return {
    payload: requestBody.payload.reduce(
      (acc: number, curr: number) => acc + curr,
      0,
    ),
    next: "delay",
  };
};
