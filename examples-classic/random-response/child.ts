import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { sendMessageToParent } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const payloadNumber = requestBody.payload as number;
  const randomNumber = await sendMessageToParent(
    { min: 1, max: 10 },
    requestBody.context,
  );
  return {
    payload: payloadNumber + randomNumber,
  };
};
