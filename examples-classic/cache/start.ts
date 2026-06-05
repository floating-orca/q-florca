import type { PluginRequestBody, ResponseBody } from "@florca/fn";

type Filename = string;

export type Page = {
  filename: Filename;
  embeddings: Filename[];
};

const pages: Page[] = [
  {
    filename: "4.md",
    embeddings: ["1.md", "2.md", "3.md"],
  },
  {
    filename: "8.md",
    embeddings: ["2.md", "3.md"],
  },
];

export type CacheMessage = {
  type: "cache";
  filename: Filename;
  content: string;
};

export type FetchMessage = {
  type: "fetch";
  filename: Filename;
};

type Message = CacheMessage | FetchMessage;

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { context } = requestBody;

  const cache: Record<string, string> = {};

  context.onMessage((message: Message) => {
    if (message.type === "cache") {
      cache[message.filename] = message.content;
    } else if (message.type === "fetch") {
      return cache[message.filename];
    }
  });

  const results = pages.map((page) => context.run("process", page));

  return {
    payload: await Promise.all(results),
  };
};
