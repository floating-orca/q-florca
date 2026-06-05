import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { context } = requestBody;
  const result = await context.run("toUpper", "Hello, world!");
  return {
    payload: result,
  };
};
