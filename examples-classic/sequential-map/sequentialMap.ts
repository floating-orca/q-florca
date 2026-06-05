import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type RequestPayload = any[];

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const elements: RequestPayload = requestBody.payload;
  const context = requestBody.context;
  const results = [];
  for (const element of elements) {
    results.push(await context.run(context.params.fn, element));
  }
  return {
    payload: results,
    next: context.params.reduce,
  };
};
