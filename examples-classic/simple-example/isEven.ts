import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const input = requestBody.payload;
  const isEven = requestBody.payload % 2 === 0;
  requestBody.context.logEvent("INFO", "Making decision based on input", {
    input,
    isEven,
  });
  return {
    payload: input,
    next: isEven ? "even" : "odd",
  };
};
