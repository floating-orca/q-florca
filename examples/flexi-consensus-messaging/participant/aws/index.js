"use strict";

// Flexibility consensus participant — EPHEMERAL message-driven variant.
// One long-lived invocation per epoch that runs a request-reply loop with the
// coordinator. Its offer is held in memory across rounds — lost on crash.

const { sendMessageToParent } = require("./fn.js");
const consensus = require("./consensus.js");

module.exports = {
  handler: async ({ payload, context }) => {
    const { slot, epoch } = payload;

    // Opt-in decision (could reject; always confirm here).
    let answer = { sender: context.id, type: "CONFIRMED", slot, epoch };
    let myOffer = undefined;
    let result = null;

    // Send our current answer, await the coordinator's next command, repeat.
    for (;;) {
      const reply = await sendMessageToParent(answer, context);
      if (!reply) break;

      if (reply.type === "GET_OFFER") {
        myOffer = await consensus.calculateOffer();
        answer = { sender: context.id, type: "OFFER", slot, epoch, offer: myOffer };
      } else if (reply.type === "PROPOSAL") {
        answer = verifyProposal(reply, epoch, slot, myOffer, context);
      } else if (reply.type === "FINAL" || reply.type === "ABORT") {
        result = reply.type === "FINAL" ? reply.result : null;
        break;
      } else {
        break;
      }
    }

    return { payload: result };
  },
};

function verifyProposal(msg, epoch, slot, myOffer, context) {
  const nack = (reason) => ({ sender: context.id, type: "NACK", slot, epoch, hash: msg.hash, reason });

  if (msg.epoch !== epoch || msg.slot !== slot) return nack("epoch or slot mismatch");
  if (consensus.hashFn(msg.result) !== msg.hash) return nack("hash mismatch");

  const myAlloc = msg.result.allocations[context.id] || { up: 0, down: 0 };
  if (!consensus.isAcceptable(myAlloc, myOffer, msg.result.prices)) return nack("unacceptable allocation");

  return { sender: context.id, type: "ACK", slot, epoch, hash: msg.hash };
}
