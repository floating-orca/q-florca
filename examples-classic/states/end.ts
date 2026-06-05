import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const promise: Promise<ResponseBody> = new Promise((resolve) => {
    requestBody.context.onWorkflowMessage((message) => {
      if (message.action === "restart") {
        resolve({
          next: "start",
          payload: message.payload,
        });
        return {
          state: "start",
          actions: ["next"],
        };
      }
      if (message.action === "finish") {
        resolve({
          payload: message.payload,
        });
        return;
      }
      return {
        state: "end",
        actions: ["restart", "finish"],
      };
    });
  });
  return await promise;
};
