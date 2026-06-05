import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type Entry = {
  language: string;
  translation: string;
};

type RequestPayload = Entry[];

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const input = requestBody.payload as RequestPayload;
  const translations = input.map((entry) =>
    `${entry.language}: ${entry.translation}`
  );
  return {
    payload: translations,
  };
};
