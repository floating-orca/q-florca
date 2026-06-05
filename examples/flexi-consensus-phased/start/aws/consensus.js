"use strict";

// Shared flexibility-consensus primitives — ported from the classic Consensus.ts.
// Copied verbatim into every function's aws/ directory so coordinator and
// participants hash and clear offers identically.

const { createHash } = require("crypto");

// Marginal price curves: price offered drops as committed flexibility rises.
const CURVE_UP = (flexibility) => Math.max(0, 10 - 0.15 * flexibility);
const CURVE_DOWN = (flexibility) => Math.max(0, 9 - 0.12 * flexibility);

// Deterministic canonical JSON so a result hashes identically everywhere.
function canonicalStringify(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k])).join(",") + "}";
}

// SHA-256 over the canonical form — binds a proposal to its offers/allocations.
function hashFn(obj) {
  return createHash("sha256").update(canonicalStringify(obj)).digest("hex");
}

// Merit-order clearing with a price-curve stop. Offers are sorted by bid; we fill
// toward the target until the curve price would fall below an offer's bid.
function clearWithCurve(offersMap, target, curve, direction) {
  const entries = Array.from(offersMap.entries()).map(([id, offer]) => ({
    id: String(id),
    max: direction === "up" ? offer.upMax : offer.downMax,
    bid: direction === "up" ? offer.upBid : offer.downBid,
  }));

  const sorted = entries.sort((a, b) => a.bid - b.bid || a.id.localeCompare(b.id));
  const qty = {};
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
      p = pNext;
    } else {
      qty[o.id] = 0;
    }
  }
  for (const o of sorted) if (!(o.id in qty)) qty[o.id] = 0;
  return { qty, price: p, acceptedTotal: F };
}

// Build a cleared proposal result from collected offers and targets.
function computeProposal(slot, epoch, offersMap, targets) {
  const ids = Array.from(offersMap.keys());
  const upClear = clearWithCurve(offersMap, targets.up, CURVE_UP, "up");
  const downClear = clearWithCurve(offersMap, targets.down, CURVE_DOWN, "down");

  const allocations = {};
  for (const id of ids) {
    allocations[id] = { up: upClear.qty[id] ?? 0, down: downClear.qty[id] ?? 0 };
  }

  const offersHash = hashFn(Array.from(offersMap.entries()));
  const result = {
    slot,
    epoch,
    targets,
    offersHash,
    allocations,
    prices: { up: upClear.price, down: downClear.price },
  };
  return { result, hash: hashFn(result) };
}

// Random local flexibility offer with a simulated device/computation delay.
async function calculateOffer() {
  const upMax = Math.max(0, 10 + Math.floor(Math.random() * 5) - 2);
  const downMax = Math.max(0, 10 + Math.floor(Math.random() * 5) - 2);
  const upBid = Math.max(0, 3 + Math.random() * 5);
  const downBid = Math.max(0, 3 + Math.random() * 5);
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 1000)));
  return { upMax, upBid, downMax, downBid };
}

// Does an allocation satisfy a participant's own offer (within max, price ≥ bid)?
function isAcceptable(myAlloc, myOffer, prices) {
  const withinMax = myAlloc.up <= myOffer.upMax + 1e-9 && myAlloc.down <= myOffer.downMax + 1e-9;
  const priceOk =
    (myAlloc.up === 0 || prices.up >= myOffer.upBid - 1e-9) &&
    (myAlloc.down === 0 || prices.down >= myOffer.downBid - 1e-9);
  return withinMax && priceOk;
}

// Sum committed up/down across an allocations map.
function totals(allocations) {
  let up = 0;
  let down = 0;
  for (const a of Object.values(allocations)) {
    up += a.up;
    down += a.down;
  }
  return { up, down };
}

module.exports = {
  CURVE_UP,
  CURVE_DOWN,
  canonicalStringify,
  hashFn,
  clearWithCurve,
  computeProposal,
  calculateOffer,
  isAcceptable,
  totals,
};
