"use strict";

// Orchestrator: invoke `child` in parallel for each i in 0..n-1,
// collecting results via stateless named callbacks and runAll batch API.

module.exports = {
  handler: async ({ payload, context }) => {
    const n = payload;
    const tasks = Array.from({ length: n }, (_, i) => ({ fn: "child", payload: i }));
    await context.runAll(tasks, "onBatchComplete", { n });
  },

  onBatchComplete: async ({ results, state, context }) => {
    const { n } = state;
    const sorted = [...results].sort((a, b) => a - b);
    const inOrder = sorted.every((val, idx) => val === idx + 1);
    return { payload: { results, inOrder } };
  }
};
