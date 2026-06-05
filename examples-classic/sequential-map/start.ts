import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type RequestPayload = number;

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const reqPayload: RequestPayload = requestBody.payload;
  return {
    payload: [...Array(reqPayload).keys()],
    next: {
      sequentialMap: {
        fn: "addOne",
        reduce: "join",
      },
    },
  };
};
