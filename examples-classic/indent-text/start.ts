import type { PluginRequestBody, ResponseBody } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { context, payload } = requestBody;
  const indentation = (payload as number) || 4;
  let text = "Hello, World!";
  for (let i = 0; i < indentation; i++) {
    text = await context.run("indent", text);
  }
  return {
    payload: { message: text },
  };
};
