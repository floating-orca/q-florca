import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const promise: Promise<ResponseBody> = new Promise((resolve) => {
    requestBody.context.onWorkflowMessage((message) => {
      if (message.action === "next") {
        resolve({
          next: "end",
          payload: message.payload,
        });
        return {
          state: "end",
          actions: ["restart", "finish"],
        };
      }
      return {
        state: "middle",
        actions: ["next"],
      };
    });
  });
  return await promise;
};
