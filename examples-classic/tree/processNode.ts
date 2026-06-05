import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import { sendMessage } from "@florca/fn";

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const context = requestBody.context;
  const { path, invocationToMessage } = requestBody.payload;

  const directories = findDirectories(path);
  await sendMessage(
    directories,
    invocationToMessage ?? context.parentId,
    context,
  );

  const files = findFiles(path);
  await new Promise((resolve) => setTimeout(resolve, 5000));

  return {
    payload: files,
  };
};

const tree: Record<string, string[]> = {
  "/": ["/d-1/", "/d-2/", "/page-1.html", "/page-2.html"],
  "/d-1/": ["/d-1/page-1-1.html", "/d-1/page-1-2.html"],
  "/d-2/": [
    "/d-2/d-2-1/",
    "/d-2/d-2-2/",
    "/d-2/page-2-1.html",
    "/d-2/page-2-2.html",
  ],
  "/d-2/d-2-1/": ["/d-2/d-2-1/page-2-1-1.html", "/d-2/d-2-1/page-2-1-2.html"],
  "/d-2/d-2-2/": ["/d-2/d-2-2/page-2-2-1.html", "/d-2/d-2-2/page-2-2-2.html"],
};

function findDirectories(path: string) {
  return tree[path].filter((child) => child.endsWith("/"));
}

function findFiles(path: string) {
  return tree[path].filter((child) => !child.endsWith("/"));
}
