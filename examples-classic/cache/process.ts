import type { PluginContext, PluginRequestBody, ResponseBody } from "@florca/fn";
import { sendMessageToParent } from "@florca/fn";
import { CacheMessage, FetchMessage, Page } from "./start.ts";

const duration = (page: string) => parseInt(page.split(".")[0]) * 1000;

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const { filename, embeddings } = requestBody.payload as Page;
  const { context } = requestBody;

  await new Promise((resolve) => setTimeout(resolve, duration(filename)));
  let content = `# ${filename}`;

  const reused: string[] = [];
  const computed: string[] = [];

  for (const embedding of embeddings) {
    let embeddingContent = await fetchEmbedding(embedding, context);
    if (!embeddingContent) {
      embeddingContent = await computeAndCacheEmbedding(embedding, context);
      computed.push(embedding);
    } else {
      reused.push(embedding);
    }
    content += ` ${embeddingContent}`;
  }
  return {
    payload: {
      filename,
      content,
      reused,
      computed,
    },
  };
};

async function fetchEmbedding(embedding: string, context: PluginContext) {
  const fetchMessage: FetchMessage = {
    type: "fetch",
    filename: embedding,
  };
  return await sendMessageToParent(fetchMessage, context);
}

async function computeAndCacheEmbedding(
  embedding: string,
  context: PluginContext,
) {
  await new Promise((resolve) => setTimeout(resolve, duration(embedding)));
  const content = `## ${embedding}`;
  const cacheMessage: CacheMessage = {
    type: "cache",
    filename: embedding,
    content,
  };
  await sendMessageToParent(cacheMessage, context);
  return content;
}
