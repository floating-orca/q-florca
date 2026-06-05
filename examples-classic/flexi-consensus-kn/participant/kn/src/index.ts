import { sendMessageToParent } from "./fn";

import type {
	Result,
	AckMsg,
	Allocation,
	FinalMsg,
	Message,
	NodeID,
	OfferRequest,
	OfferResponse,
	ProposalMsg,
	StartNegotiationRequest,
	StartNegotiationResponse,
	TimeSlot,
	Offer,
} from "./Consensus";


import * as Consensus from "./Consensus";


export const handle = async (
	_: unknown,
	requestBody: any
): Promise<unknown> => {
	const input: StartNegotiationRequest = requestBody.payload;
	const context = requestBody.context;

	let answerToParent: Message | null = onStartNegotiationRequest(input, context);

	if (answerToParent.type === "NEGOTIATION_REJECTED") {
		sendMessageToParent(answerToParent, context);
		return {
			body: {
				payload: undefined,
				next: undefined,
			},
		};
	}

	const epoch = input.epoch;
	const slot = input.slot;
	let myOffer: Offer | undefined = undefined;
	let result: Result | undefined = undefined;

	while (answerToParent !== null) {
		// wait after answering the parent for new command
		const messageFromParent = await sendMessageToParent(
			answerToParent,
			context
		);

		if (messageFromParent.type === "GET_OFFER") {
			answerToParent = await onGetOfferRequest(messageFromParent, epoch, slot, context);
			myOffer = answerToParent.offer;
		} else if (messageFromParent.type === "PROPOSAL") {
			answerToParent = await onProposalMessage(messageFromParent, epoch, slot, context, myOffer!);
			// no answer to parent

		} else if (
			messageFromParent.type === "FINAL" ||
			messageFromParent.type === "ABORT"
		) {
			// break the loop and end the workflow
			// commit the final result to our devices / flexibility management system or if aborted do nothing
			result = messageFromParent.type === "FINAL" ? messageFromParent.result : undefined;
			answerToParent = null;
		} else {
			console.error(`[PARTICIPANT] Unknown message type: ${messageFromParent.type}`);
		}
	}

	return {
		body: {
			payload: result,
		},
		headers: {
			"Content-Type": "application/json",
		},
	};
};


/**
 * This is the response to startNegotiation request. A client can decide if it wants to participate or not.
 * For now it rejcts with 20% probability.
 * @param payload the start negotiation request message
 * @returns
 */
const onStartNegotiationRequest = (
	payload: StartNegotiationRequest,
	context: any
): StartNegotiationResponse => {
	if (Math.random() < 0) {
		return {
			type: "NEGOTIATION_REJECTED",
			slot: payload.slot,
			epoch: payload.epoch,
		} as StartNegotiationResponse;
	}

	return {
		sender: context.id,
		type: "NEGOTIATION_CONFIRMED",
		slot: payload.slot,
		epoch: payload.epoch,
	} as StartNegotiationResponse;
};

/**
 * This function calculates the actual offer
 * @param msg
 * @returns
 */
const onGetOfferRequest = async (
	msg: OfferRequest,
	epoch: number,
	slot: TimeSlot,
	context: any
): Promise<OfferResponse> => {
	const offer = await calculateOffer(msg.slot);
	const offerResponse: OfferResponse = {
		sender: context.id,
		type: "OFFER",
		slot: slot,
		epoch: epoch,
		offer,
	};

	return offerResponse;
};

const onProposalMessage = async (
	msg: ProposalMsg,
	epoch: number,
	slot: TimeSlot,
	context: any,
	myOffer: Offer
): Promise<AckMsg> => {
	if (msg.epoch !== epoch || msg.slot !== slot) {
		return {
			sender: context.id,
			type: "NACK",
			slot: msg.slot,
			epoch: msg.epoch,
			hash: msg.hash,
			reason: "Epoch or slot mismatch",
		} as AckMsg;
	}

	// verify hash
	const computedHash = await Consensus.default.HASH_FN(msg.result);
	if (computedHash !== msg.hash) {
		return {
			sender: context.id,
			type: "NACK",
			slot: msg.slot,
			epoch: msg.epoch,
			hash: msg.hash,
			reason: "Hash mismatch",
		} as AckMsg;
	}

	// acceptability checks
	const myAlloc: Allocation = msg.result.allocations[context.id];
	const withinMax =
		myAlloc.up <= myOffer.upMax + 1e-9 &&
		myAlloc.down <= myOffer.downMax + 1e-9;

	const priceOk =
		(myAlloc.up === 0 || msg.result.prices.up >= myOffer.upBid - 1e-9) &&
		(myAlloc.down === 0 || msg.result.prices.down >= myOffer.downBid - 1e-9);

	if (!withinMax) {
		return {
			sender: context.id,
			type: "NACK",
			slot: msg.slot,
			epoch: msg.epoch,
			hash: msg.hash,
			reason: "Exceeds max",
		} as AckMsg;
	}
	if (!priceOk) {
		return {
			sender: context.id,
			type: "NACK",
			slot: msg.slot,
			epoch: msg.epoch,
			hash: msg.hash,
			reason: "Price below bid",
		} as AckMsg;
	}

	return {
		sender: context.id,
		type: "ACK",
		slot: msg.slot,
		epoch: msg.epoch,
		hash: msg.hash,
	} as AckMsg;
};

/**
 * Right now this function just generates random offers.
 * In a real implementation, this would be based on the local flexibility potential and pricing strategy.
 * @param slot
 * @returns
 */
const calculateOffer = async (_: TimeSlot): Promise<Offer> => {
	const baseUp = 10;
	const baseDown = 10;

	// random noise (e.g., +-2kW)
	const upMax = baseUp + Math.floor(Math.random() * 5) - 2;
	const downMax = baseDown + Math.floor(Math.random() * 5) - 2;

	// random bids between 3 and 8
	const upBid = 3 + Math.random() * 5;
	const downBid = 3 + Math.random() * 5;

	// random sleep to simulate computation and device delay
	await new Promise((resolve) =>
		setTimeout(resolve, Math.floor(Math.random() * 1000))
	);

	return {
		upMax: Math.max(0, upMax),
		upBid: Math.max(0, upBid),
		downMax: Math.max(0, downMax),
		downBid: Math.max(0, downBid),
	} as Offer;
};
