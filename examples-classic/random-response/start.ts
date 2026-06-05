import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { randomIntegerBetween } from "jsr:@std/random";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { context } = requestBody;

  context.onMessage((message) => {
    const { min, max } = message;
    return randomIntegerBetween(min, max);
  });

  const result = await context.run("child", 5);

  return {
    payload: result,
  };
};
