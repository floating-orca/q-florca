import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const promise: Promise<ResponseBody> = new Promise((resolve) => {
    requestBody.context.onWorkflowMessage((message) => {
      if (message.action === "next") {
        resolve({
          next: "middle",
          payload: message.payload,
        });
        return {
          state: "middle",
          actions: ["next"],
        };
      }
      return {
        state: "start",
        actions: ["next"],
      };
    });
  });
  return await promise;
};
