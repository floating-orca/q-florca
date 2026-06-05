"use strict";

// Flexibility consensus — FAULT-TOLERANT phased coordinator.
//
// Each protocol round is a context.runAll fan-out with a named callback. All
// accumulated state (offers, proposal, epoch, best-so-far) is threaded through
// the callback `state` argument, which FLORCA persists to the per-invocation agg
// queue. If the coordinator's Lambda crashes mid-negotiation it is re-invoked,
// replays the agg snapshot, and resumes the round in progress — no state is lost.
//
// Participants are stateless per round: identity is the fan-out index ("node-i"),
// and each participant's own offer is passed back to it in the PROPOSAL round so
// it can re-verify its allocation without holding state between rounds.

const consensus = require("./consensus.js");

const NODE_COUNT = 5;

module.exports = {
  handler: async ({ payload, context }) => {
    const target = payload?.target ?? 30;
    const slot = payload?.slot ?? "2025-11-21T18:00/19:00";
    const maxEpochs = payload?.maxEpochs ?? 5;
    await startEpoch(context, { epoch: 1, slot, target, maxEpochs, bestPartial: null });
  },

  // ── Round 1 result: who is participating? ───────────────────────────────────
  onAnswers: async ({ results, state, context }) => {
    const confirmedCount = results.filter((r) => r && r.type === "CONFIRMED").length;
    if (confirmedCount === 0) {
      return finishOrRetry(context, { ...state, confirmedCount: 0 }, null);
    }
    // Ask every confirmed participant for its flexibility offer.
    await context.runAll(
      fanout(confirmedCount, { type: "GET_OFFER", slot: state.slot, epoch: state.epoch }),
      "onOffers",
      { ...state, confirmedCount }
    );
  },

  // ── Round 2 result: offers in → clear market and propose ─────────────────────
  onOffers: async ({ results, state, context }) => {
    const offers = results.map((r) => (r && r.offer) || null);
    const offersMap = new Map();
    offers.forEach((o, i) => { if (o) offersMap.set(`node-${i}`, o); });

    const { result, hash } = consensus.computeProposal(
      state.slot, state.epoch, offersMap, { up: state.target, down: state.target }
    );

    // Send each participant the proposal plus its own offer for verification.
    await context.runAll(
      offers.map((offer, i) => ({
        fn: "participant",
        payload: { type: "PROPOSAL", slot: state.slot, epoch: state.epoch,
                   myId: `node-${i}`, myOffer: offer, result, hash },
      })),
      "onAcks",
      { ...state, offers, proposal: result, proposalHash: hash }
    );
  },

  // ── Round 3 result: ACK/NACK → commit (FINAL) or ABORT ───────────────────────
  onAcks: async ({ results, state, context }) => {
    const acks = results.filter((r) => r && r.type === "ACK").length;
    const allAcked = acks === state.confirmedCount;
    const t = consensus.totals(state.proposal.allocations);
    const targetsMet =
      Math.abs(t.up - state.target) < 0.1 && Math.abs(t.down - state.target) < 0.1;
    const commit = allAcked && targetsMet;

    const msg = commit
      ? { type: "FINAL", slot: state.slot, epoch: state.epoch, result: state.proposal }
      : { type: "ABORT", slot: state.slot, epoch: state.epoch };

    await context.runAll(
      fanout(state.confirmedCount, msg),
      "onCommitted",
      { ...state, commit }
    );
  },

  // ── Round 4 result: round committed/aborted → done or next epoch ──────────────
  onCommitted: async ({ state, context }) => {
    return finishOrRetry(context, state, state.commit ? state.proposal : null);
  },
};

// Fan out the identical message to `n` participants.
function fanout(n, payload) {
  return Array.from({ length: n }, () => ({ fn: "participant", payload }));
}

// Kick off a fresh epoch.
async function startEpoch(context, state) {
  await context.runAll(
    fanout(NODE_COUNT, { type: "START_NEGOTIATION", slot: state.slot, epoch: state.epoch,
                         target: { up: state.target, down: state.target } }),
    "onAnswers",
    state
  );
}

// Decide whether the workflow is done or should retry with the next epoch.
// `committed` is the final result if this epoch reached consensus, else null.
function finishOrRetry(context, state, committed) {
  if (committed) {
    return { payload: { success: true, result: committed, epochsNeeded: state.epoch } };
  }
  if (state.epoch >= state.maxEpochs) {
    return {
      payload: {
        success: false,
        result: state.bestPartial,
        insufficientAllocation: state.bestPartial !== null,
        totalEpochsAttempted: state.epoch,
      },
    };
  }
  // Carry forward the most complete partial proposal we have seen.
  const bestPartial = state.proposal ?? state.bestPartial;
  return startEpoch(context, { ...state, epoch: state.epoch + 1, bestPartial, proposal: null });
}
