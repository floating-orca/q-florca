"use strict";

module.exports = {
  handler: async ({ payload, context }) => {
    const url = payload.url.replace(/\/$/, "");
    await context.runAll(
      [{ fn: "crawl", payload: { url } }],
      "onBatchCrawled",
      { visited: [url], videoLinks: [] }
    );
  },

  onBatchCrawled: async ({ results, state, context }) => {
    const { visited, videoLinks } = state;

    const newVideoLinks = [
      ...videoLinks,
      ...results.flatMap(r => (r && r.videoLinks) || []),
    ];
    const discovered = results.flatMap(r => (r && r.pageLinks) || []);
    const newUrls = [...new Set(discovered)].filter(u => !visited.includes(u));

    if (newUrls.length === 0) {
      return { payload: { crawled: visited, videoLinks: newVideoLinks } };
    }

    await context.runAll(
      newUrls.map(u => ({ fn: "crawl", payload: { url: u } })),
      "onBatchCrawled",
      { visited: [...visited, ...newUrls], videoLinks: newVideoLinks }
    );
  },
};
