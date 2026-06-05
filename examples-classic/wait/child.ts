import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { sendMessageToParent } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  // Send a message to the parent and wait for the response
  const responseFromParent = await sendMessageToParent(
    null,
    requestBody.context,
  );

  return {
    // Just append an exclamation mark to the response from the parent
    payload: responseFromParent + "!",
  };
};
