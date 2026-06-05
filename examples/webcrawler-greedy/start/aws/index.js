"use strict";

module.exports = {
  handler: async ({ payload, context }) => {
    const url = payload.url.replace(/\/$/, "");

    // Ephemeral global dedup — lost on crash, but duplicates are acceptable.
    context._crawled = new Set([url]);
    context._videoLinks = [];

    await context.run("crawl", { url }, "onBatch");
  },

  onBatch: async ({ results, context }) => {
    const newUrls = [];
    for (const r of results || []) {
      if (r?.videoLinks) context._videoLinks.push(...r.videoLinks);
      for (const u of r?.pageLinks || []) {
        if (!context._crawled.has(u)) {
          context._crawled.add(u);
          newUrls.push(u);
        }
      }
    }

    if (newUrls.length === 0) {
      return { payload: { crawled: [...context._crawled], videoLinks: context._videoLinks } };
    }

    await context.runAll(
      newUrls.map(u => ({ fn: "crawl", payload: { url: u } })),
      "onBatch"
    );
  },
};
