"use strict";

// Flexibility consensus participant — PHASED variant.
// Stateless: one invocation per protocol round. The coordinator passes back this
// participant's own offer in the PROPOSAL round so no state is held between rounds.

const consensus = require("./consensus.js");

module.exports = {
  handler: async ({ payload }) => {
    switch (payload.type) {
      case "START_NEGOTIATION":
        // Opt-in decision. Could reject (e.g. Math.random() < 0.2); always confirm here.
        return { payload: { type: "CONFIRMED" } };

      case "GET_OFFER": {
        const offer = await consensus.calculateOffer();
        return { payload: { type: "OFFER", offer } };
      }

      case "PROPOSAL": {
        const { myId, myOffer, result, hash } = payload;
        if (consensus.hashFn(result) !== hash) {
          return { payload: { type: "NACK", reason: "hash mismatch" } };
        }
        const myAlloc = result.allocations[myId] || { up: 0, down: 0 };
        if (!consensus.isAcceptable(myAlloc, myOffer, result.prices)) {
          return { payload: { type: "NACK", reason: "unacceptable allocation" } };
        }
        return { payload: { type: "ACK" } };
      }

      case "FINAL":
        // Commit the allocation to the local device / flexibility management system.
        return { payload: { type: "COMMITTED" } };

      case "ABORT":
        return { payload: { type: "ABORTED" } };

      default:
        return { payload: { type: "UNKNOWN" } };
    }
  },
};
