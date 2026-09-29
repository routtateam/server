import { ValidationError } from "@/common/utils/errors";

export interface DepositOutcome {
  /** Damage claim actually recorded, capped at the held deposit (kobo). */
  claimAmount: number;
  /** Remainder owed back to the commuter (kobo) = held - claim. */
  refundAmount: number;
  /**
   * "refunded"  : no claim, the full deposit goes back to the commuter.
   * "disputed"  : the partner claimed part/all of it; the amounts are PROPOSED and Routta reviews within 24h
   *               (admin /premium/deposits/:id decides). Nothing moves until then.
   */
  status: "refunded" | "disputed";
}

/**
 * Deposit maths for a return inspection. Pure function (unit-tested).
 * - claim is clamped to [0, held]; a claim without any "issue" item is rejected;
 * - refund = held - claim.
 */
export function computeDepositOutcome(heldAmount: number, requestedClaim: number, issueCount: number): DepositOutcome {
  if (!Number.isInteger(heldAmount) || heldAmount < 0) throw new ValidationError("Invalid deposit amount.");
  if (!Number.isInteger(requestedClaim) || requestedClaim < 0) throw new ValidationError("Damage claim must be a non-negative amount in kobo.");
  if (requestedClaim > 0 && issueCount === 0) throw new ValidationError("Mark at least one checklist item as an issue to claim damage.");
  const claimAmount = Math.min(requestedClaim, heldAmount);
  return {
    claimAmount,
    refundAmount: heldAmount - claimAmount,
    status: claimAmount === 0 ? "refunded" : "disputed",
  };
}
