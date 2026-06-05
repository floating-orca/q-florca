// TODO ideally this file is shared between consensus nodes and mediators

type TimeSlot = string; // e.g., "2025-11-21T18:00Z/19:00Z"
type NodeID = string; 

type Offer = {
  upMax: number;        // kW upward flexibility max
  upBid: number;        // min acceptable price for upward flex
  downMax: number;      // kW downward flexibility max
  downBid: number;      // min acceptable price for downward flex
};

type Allocation = {
  up: number;           // kW upward committed by participant
  down: number;         // kW downward committed by participant
};

type Result = {
  slot: TimeSlot;
  epoch: number;
  targets: Allocation;
  allocations: Record<string, Allocation>;
  prices: { up: number; down: number };
  offersHash: string; // simple hash to bind proposal to offers
};

type StartNegotiationRequest =  {
  sender: NodeID; 
  type: "START_NEGOTIATION";
  slot: TimeSlot; 
  epoch: number;
  target: Allocation;
}

type StartNegotiationResponse = {
  sender: NodeID;
  type: "NEGOTIATION_CONFIRMED" | "NEGOTIATION_REJECTED";
  slot: TimeSlot; 
  epoch: number;
}

type OfferRequest = {
  sender: NodeID;
  type: "GET_OFFER";
  epoch: number; 
  slot: TimeSlot;
  target: Allocation;
};

type OfferResponse = {
  sender: NodeID;
  type: "OFFER";
  slot: TimeSlot;
  epoch: number;
  offer: Offer;
};

type ProposalMsg = {
  type: "PROPOSAL";
  slot: TimeSlot;
  epoch: number;
  sender: NodeID;
  result: Result;
  hash: string;
};

type AckMsg = {
  sender: NodeID;
  type: "ACK" | "NACK";
  slot: TimeSlot;
  epoch: number;
  hash: string;
  reason?: string;
};

type FinalMsg = {
  sender: NodeID;
  type: "FINAL";
  slot: TimeSlot;
  epoch: number;
  result: Result;
  ackFrom: string[];
};

type AbortMsg = {
  sender: NodeID;
  type: "ABORT";
  slot: TimeSlot; 
  epoch: number;
}

const CURVE_UP: (flexibility: number) => number = (flexibility: number): number => Math.max(0, 10 - 0.15 * flexibility);
const CURVE_DOWN: (flexibility: number) => number = (flexibility: number): number => Math.max(0, 9 - 0.12 * flexibility);

/**
 * Deterministic canonical JSON stringification for hashing
 * Recursively sorts all object keys to ensure consistent ordering
 */
const canonicalStringify = (obj: any): string => {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(item => canonicalStringify(item)).join(',') + ']';
  }

  // Sort object keys and recursively stringify
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => {
    return JSON.stringify(key) + ':' + canonicalStringify(obj[key]);
  });

  return '{' + pairs.join(',') + '}';
};

/**
 * SHA-256 hash function using Web Crypto API
 * More computationally expensive and realistic for consensus protocols
 */
const HASH_FN = async (obj: unknown): Promise<string> => {
  const canonical = canonicalStringify(obj);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
};

type Message = OfferRequest | OfferResponse | ProposalMsg | AckMsg | FinalMsg | StartNegotiationRequest | StartNegotiationResponse | AbortMsg;

export type {FinalMsg, AckMsg, ProposalMsg, OfferResponse, OfferRequest, Result, Allocation, Offer, TimeSlot, Message, StartNegotiationRequest, StartNegotiationResponse, NodeID};
export default {CURVE_UP, CURVE_DOWN, HASH_FN};