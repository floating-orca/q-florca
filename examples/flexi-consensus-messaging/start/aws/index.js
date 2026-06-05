"use strict";

// Flexibility consensus — EPHEMERAL message-driven coordinator.
//
// Faithful port of the classic design: each participant runs a request-reply loop
// (sendMessageToParent), and this coordinator's onMessage handler returns the next
// command as the reply. Phase synchronization uses Promise.withResolvers barriers.
//
// All protocol state (participants, offers, acks, barriers) lives in ephemeral
// context fields — it is NOT persisted to the agg queue, so a coordinator crash
// loses the in-flight negotiation. This is the "lossy" counterpart to the phased,
// fault-tolerant variant. The epoch-retry loop is driven by the runAll callback
// that fires once every participant invocation has returned.

const consensus = require("./consensus.js");

const NODE_COUNT = 5;

module.exports = {
  handler: async ({ payload, context }) => {
    context._cfg = {
      target: payload?.target ?? 30,
      slot: payload?.slot ?? "2025-11-21T18:00/19:00",
      maxEpochs: payload?.maxEpochs ?? 5,
      nodeCount: NODE_COUNT,
    };
    context._result = null;
    context._bestPartial = null;
    context._proto = newEpochState(1);

    context.onMessage((msg) => handleMessage(msg, context));
    await startEpoch(context, 1);
  },

  // Fires once all participant invocations for the current epoch have returned.
  onEpochDone: async ({ context }) => {
    const p = context._proto;
    const cfg = context._cfg;

    if (context._result) {
      return { payload: { success: true, result: context._result, epochsNeeded: p.epoch } };
    }
    if (p.epoch >= cfg.maxEpochs) {
      return {
        payload: {
          success: false,
          result: context._bestPartial,
          insufficientAllocation: context._bestPartial !== null,
          totalEpochsAttempted: p.epoch,
        },
      };
    }
    context._proto = newEpochState(p.epoch + 1);
    await startEpoch(context, p.epoch + 1);
  },
};

// Fresh per-epoch protocol state, including the three phase barriers.
function newEpochState(epoch) {
  return {
    epoch,
    participants: [],
    nonParticipants: [],
    offers: new Map(),
    acks: [],
    nacks: [],
    proposal: null,
    answered: Promise.withResolvers(),
    offersIn: Promise.withResolvers(),
    acksIn: Promise.withResolvers(),
  };
}

async function startEpoch(context, epoch) {
  const cfg = context._cfg;
  await context.runAll(
    Array.from({ length: cfg.nodeCount }, () => ({
      fn: "participant",
      payload: { type: "START_NEGOTIATION", slot: cfg.slot, epoch,
                 target: { up: cfg.target, down: cfg.target } },
    })),
    "onEpochDone"
  );
}

// Handle one participant message; the return value is sent back as the reply.
async function handleMessage(msg, context) {
  const p = context._proto;
  const cfg = context._cfg;
  if (!msg || msg.epoch !== p.epoch || msg.slot !== cfg.slot) return null;

  if (msg.type === "CONFIRMED" || msg.type === "REJECTED") {
    (msg.type === "CONFIRMED" ? p.participants : p.nonParticipants).push(msg.sender);
    if (p.participants.length + p.nonParticipants.length === cfg.nodeCount) p.answered.resolve();
    await p.answered.promise;
    if (msg.type === "REJECTED") return null;
    return { type: "GET_OFFER", epoch: p.epoch, slot: cfg.slot,
             target: { up: cfg.target, down: cfg.target } };
  }

  if (msg.type === "OFFER") {
    p.offers.set(msg.sender, msg.offer);
    if (p.offers.size === p.participants.length) p.offersIn.resolve();
    await p.offersIn.promise;
    if (!p.proposal) {
      p.proposal = consensus.computeProposal(
        cfg.slot, p.epoch, p.offers, { up: cfg.target, down: cfg.target }
      ).result;
    }
    return { type: "PROPOSAL", slot: cfg.slot, epoch: p.epoch,
             sender: context.id, result: p.proposal, hash: consensus.hashFn(p.proposal) };
  }

  if (msg.type === "ACK" || msg.type === "NACK") {
    (msg.type === "ACK" ? p.acks : p.nacks).push(msg.sender);
    if (p.acks.length + p.nacks.length === p.participants.length) p.acksIn.resolve();
    await p.acksIn.promise;

    const allAcked = p.acks.length === p.participants.length;
    const t = consensus.totals(p.proposal.allocations);
    const targetsMet =
      Math.abs(t.up - cfg.target) < 0.1 && Math.abs(t.down - cfg.target) < 0.1;

    if (allAcked && targetsMet) {
      context._result = p.proposal;
      return { type: "FINAL", slot: cfg.slot, epoch: p.epoch, result: p.proposal };
    }
    context._bestPartial = p.proposal;
    return { type: "ABORT", slot: cfg.slot, epoch: p.epoch };
  }

  return null;
}
