import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { randomIntegerBetween } from "jsr:@std/random";

export default async (
  _requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const number = randomIntegerBetween(1, 10);
  return {
    payload: number,
    next: "isEven",
  };
};
