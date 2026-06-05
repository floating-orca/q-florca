import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { randomIntegerBetween } from "jsr:@std/random";

export default async (
  _requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const number = randomIntegerBetween(2, 10);
  return {
    payload: ["p1.png", `p${number}.png`],
    next: {
      map: {
        fn: "transformImage",
        reduce: "mergeAndStore",
      },
    },
  };
};
