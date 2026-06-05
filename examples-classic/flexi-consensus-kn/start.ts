import type { PluginRequestBody, ResponseBody } from "@florca/fn";
import type {
  AckMsg,
  Allocation,
  FinalMsg,
  Message,
  NodeID,
  Offer,
  OfferRequest,
  OfferResponse,
  ProposalMsg,
  StartNegotiationRequest,
  StartNegotiationResponse,
  TimeSlot,
  AbortMsg,
  Result,
} from "./Consensus.ts";
import * as Consensus from "./Consensus.ts";

type Input = {}; // Define the input type

export default async (
  requestBody: PluginRequestBody,
): Promise<ResponseBody> => {
  const nodes: NodeID[] = [
    "node-1",
    "node-2",
    "node-3",
    "node-4",
    "node-5",
  ];
  const target = requestBody.payload?.target || 30;
  const slot = requestBody.payload?.slot || "2025-11-21T18:00/19:00";
  const maxEpochs = requestBody.payload?.maxEpochs || 5;

  let epoch = 1;
  let consensusResult: Result | null = null;
  let bestPartialResult: Result | null = null;
  let insufficientAllocation = false;

  while (epoch <= maxEpochs && consensusResult === null) {
    console.log(`[START] Attempting consensus for epoch ${epoch}`);
    const result = await findConsensus(requestBody, epoch, nodes, slot, target, target);

    if (result === null) {
      console.log(`[START] Consensus failed for epoch ${epoch}, retrying...`);
      epoch++;
    } else {
      // Check if this result meets targets
      const totalAllocatedUp = Object.values(result.allocations).reduce((sum, alloc) => sum + alloc.up, 0);
      const totalAllocatedDown = Object.values(result.allocations).reduce((sum, alloc) => sum + alloc.down, 0);

      const targetsMet =
        Math.abs(totalAllocatedUp - target) < 0.1 &&
        Math.abs(totalAllocatedDown - target) < 0.1;

      if (targetsMet) {
        consensusResult = result;
        console.log(`[START] Consensus reached in epoch ${epoch}`);
      } else {
        // Keep track of the best partial result
        bestPartialResult = result;
        insufficientAllocation = true;
        console.log(`[START] Consensus reached but insufficient allocation in epoch ${epoch}, retrying...`);
        epoch++;
      }
    }
  }

  if (consensusResult === null && insufficientAllocation) {
    console.log(`[START] Failed to meet targets after ${maxEpochs} epochs - insufficient capacity available`);
  } else if (consensusResult === null) {
    console.log(`[START] Failed to reach consensus after ${maxEpochs} epochs`);
  }

  return {
    payload: {
      success: consensusResult !== null,
      result: consensusResult || bestPartialResult,
      insufficientAllocation: insufficientAllocation && consensusResult === null,
      epochsNeeded: consensusResult !== null ? epoch : null,
      totalEpochsAttempted: epoch - 1,
    },
    next: undefined,
  };
};

const findConsensus = async (
  requestBody: PluginRequestBody,
  epoch: number,
  nodes: NodeID[],
  slot: TimeSlot = "2025-11-21T18:00/19:00",
  targetUp: number = 30,
  targetDown: number = 30,
): Promise<Result | null> => {

  const context = requestBody.context;

  const participants = [] as NodeID[];
  const nonParticipants = [] as NodeID[];
  const offers = new Map<NodeID, Offer>();

  const promiseWithResolverAnswer = Promise.withResolvers<void>();
  const everyOneAnsweredPromise = promiseWithResolverAnswer.promise;
  const resolveEveryoneAnswered = promiseWithResolverAnswer.resolve;

  const promiseWithResolverOffers = Promise.withResolvers<void>();
  const everyOneSubmittedOffersPromise = promiseWithResolverOffers.promise;
  const resolveEveryoneSubmittedOffers = promiseWithResolverOffers.resolve;

  const promisewithResolverAcks = Promise.withResolvers<void>();
  const everyOneSentAcksPromise = promisewithResolverAcks.promise;
  const resolveEveryoneSentAcks = promisewithResolverAcks.resolve;

  const acks = [] as NodeID[];
  const nacks = [] as NodeID[];
  let proposedResult: Result | undefined = undefined;
  let finalResult: Result | null = null;



  context.onMessage(async (message: Message) => {
    // Handle incoming messages if needed
    if (message.type === "NEGOTIATION_CONFIRMED" && message.epoch === epoch && message.slot === slot) {
      participants.push(message.sender);
      if (participants.length + nonParticipants.length === nodes.length) {
        resolveEveryoneAnswered();
      }
      await everyOneAnsweredPromise;
      return getAnswerForNegotiationConfirmed(message, epoch, slot, targetUp, targetDown, context); // participant should send an OfferRequest
    } else if (message.type === "NEGOTIATION_REJECTED" && message.epoch === epoch && message.slot === slot) {
      nonParticipants.push(message.sender);
      if (nonParticipants.length + participants.length === nodes.length) {
        resolveEveryoneAnswered();
      }
      await everyOneAnsweredPromise;
      return null; // no further action from the participants side reqeueste
    } else if (message.type === "OFFER") {
      // collect offers
      if (!message.epoch || message.epoch !== epoch) {
        console.error(`[START] Received OFFER for wrong epoch: ${message.epoch}`);
        return;
      }
      if (message.slot !== slot) {
        console.error(`[START] Received OFFER for wrong slot: ${message.slot}`);
        return;
      }

      offers.set(message.sender, message.offer);
      // once all offers are collected, resolve the promise
      if (offers.size === participants.length) {
        resolveEveryoneSubmittedOffers();
      }
      await everyOneSubmittedOffersPromise;

      const proposal = await computeAndPropose(slot, epoch, offers, { up: targetUp, down: targetDown }, context);
      proposedResult = proposal.result;

      return proposal;

    } else if (message.type === "ACK" || message.type === "NACK") {
      if (message.epoch !== epoch || message.slot !== slot) {
        console.error(`[START] Received ${message.type} for wrong epoch/slot`);
        return null;
      }

      if (message.type === "ACK") {
        acks.push(message.sender);
      } else {
        nacks.push(message.sender);
        console.log(`[START] Epoch ${epoch}: NACK from ${message.sender}: ${message.reason}`);
      }

      if (acks.length + nacks.length === participants.length) {
        resolveEveryoneSentAcks();
      }

      await everyOneSentAcksPromise;

      // Send FINAL or ABORT based on consensus
      if (acks.length === participants.length) {
        // Check if allocated totals meet the targets
        const totalAllocatedUp = Object.values(proposedResult!.allocations).reduce((sum, alloc) => sum + alloc.up, 0);
        const totalAllocatedDown = Object.values(proposedResult!.allocations).reduce((sum, alloc) => sum + alloc.down, 0);

        const targetsMet =
          Math.abs(totalAllocatedUp - targetUp) < 0.1 &&
          Math.abs(totalAllocatedDown - targetDown) < 0.1;

        if (targetsMet) {
          console.log(`[START] Epoch ${epoch}: Consensus reached (${acks.length}/${participants.length} ACKs, targets met: up=${totalAllocatedUp}/${targetUp}, down=${totalAllocatedDown}/${targetDown})`);
          finalResult = proposedResult!;
          return {
            sender: context.id,
            type: "FINAL",
            slot: slot,
            epoch: epoch,
            result: proposedResult!,
            ackFrom: acks,
          };
        } else {
          console.log(`[START] Epoch ${epoch}: Targets not met (up=${totalAllocatedUp}/${targetUp}, down=${totalAllocatedDown}/${targetDown}), sending ABORT`);
          // Still capture this result as it represents the best allocation possible
          finalResult = proposedResult!;
          return {
            sender: context.id,
            type: "ABORT",
            slot: slot,
            epoch: epoch,
          };
        }
      } else {
        console.log(`[START] Epoch ${epoch}: Consensus failed (${acks.length} ACKs, ${nacks.length} NACKs)`);
        return {
          sender: context.id,
          type: "ABORT",
          slot: slot,
          epoch: epoch,
        };
      }
    }
  });



  // Start Negotiation
  console.log(`[START] Epoch ${epoch}: Starting negotiation with ${nodes.length} nodes`);
  const startNegotiationInvocations = nodes.map((nodeId) =>
    context.run("participant", {
      type: "START_NEGOTIATION",
      slot: slot,
      epoch: epoch,
      target: { up: targetUp, down: targetDown },
    } as StartNegotiationRequest)
  );

  // wait for this round to finish
  const participationResults = await Promise.all(startNegotiationInvocations);

  return finalResult;
};

const getAnswerForNegotiationConfirmed = (
  StartNegotiationResponse: StartNegotiationResponse,
  epoch: number,
  slot: TimeSlot,
  targetUp: number,
  targetDown: number,
  context: any,
): OfferRequest => {

  return {
      sender: context.id,
      type: "GET_OFFER",
      epoch: epoch,
      slot: slot,
      target: { up: targetUp, down: targetDown },
    } as OfferRequest;
}

const computeAndPropose = async (
    slot: TimeSlot,
    epoch: number,
    offersMap: Map<NodeID, Offer>,
    targets: Allocation,
    context: any,
  ): Promise<ProposalMsg> => {

    const participantIds = Array.from(offersMap.keys()) as NodeID[];

    const upClear = clearWithCurve(offersMap, targets.up, Consensus.default.CURVE_UP, 'up');
    const downClear = clearWithCurve(offersMap, targets.down, Consensus.default.CURVE_DOWN, 'down');

    const allocations: Record<string, Allocation> = {};
    for (const id of participantIds) {
      allocations[id] = {
        up: upClear.qty[id] ?? 0,
        down: downClear.qty[id] ?? 0,
      };
    }

    const offersHash = await Consensus.default.HASH_FN(Array.from(offersMap.entries()));
    const result: Result = {
      slot,
      epoch,
      targets,
      offersHash,
      allocations,
      prices: { up: upClear.price, down: downClear.price },
    } as Result;
    const h = await Consensus.default.HASH_FN(result);

    return {
      type: "PROPOSAL",
      slot,
      epoch,
      sender: context.id,
      result,
      hash: h,
    } as ProposalMsg;
  }


/** Merit-order clearing with price curve stop */
const clearWithCurve = (
  offersMap: Map<NodeID, Offer>,
  target: number,
  curve: (F: number) => number,
  direction: 'up' | 'down',
): { qty: Record<string, number>; price: number; acceptedTotal: number } => {
  const entries = Array.from(offersMap.entries()).map(([id, offer]) => ({
    id: String(id),
    max: direction === 'up' ? offer.upMax : offer.downMax,
    bid: direction === 'up' ? offer.upBid : offer.downBid,
  }));

  const sorted = entries.sort((a, b) =>
    a.bid - b.bid || a.id.localeCompare(b.id)
  );
  const qty: Record<string, number> = {};
  let F = 0;
  let p = 0;

  for (const o of sorted) {
    if (F >= target) break;

    const takeCandidate = Math.max(0, Math.min(o.max, target - F));
    if (takeCandidate === 0) {
      qty[o.id] = 0;
      continue;
    }

    const Fnext = F + takeCandidate;
    const pNext = curve(Fnext);

    if (o.bid <= pNext + 1e-9) {
      qty[o.id] = takeCandidate;
      F = Fnext;
      p = pNext; // price determined by curve at accepted total
    } else {
      qty[o.id] = 0; // auto back-off by exclusion
    }
  }

  // ensure all ids present
  for (const o of sorted) if (!(o.id in qty)) qty[o.id] = 0;

  return { qty, price: p, acceptedTotal: F };
}

