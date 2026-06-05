const { sendMessage, sendMessageToParent, sendMessageToWorkflow } = require("./fn.js");

exports.handler = async (requestBody) => {
  const context = requestBody.context;
  const { path, invocationToMessage } = requestBody.payload;

  const directories = findDirectories(path);
  await sendMessage(directories, invocationToMessage, context);

  const files = findFiles(path);

  return {
    payload: files,
  };
};

const tree = {
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

function findDirectories(path) {
  return tree[path].filter((child) => child.endsWith("/"));
}

function findFiles(path) {
  return tree[path].filter((child) => !child.endsWith("/"));
}
