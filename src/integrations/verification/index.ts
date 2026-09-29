// Identity/License/Number-Plate verification adapter — RESEARCH-ONLY STUB.
//
// NOT wired to any real provider. See ./README.md for what the frontends
// expect, a researched shortlist of Nigeria-focused providers (Prembly,
// Youverify, Smile Identity, Dojah, VerifyMe), and what's required before
// this can go live. Per explicit project instruction, choosing and
// integrating a real provider requires the user's approval — this file
// exists only so the rest of the backend (driver/business document review)
// has a stable interface to call today.
//
// Every method below returns a mocked "pending manual review" result and
// never makes an external HTTP call, regardless of any env var.
import { logger } from "@/common/utils/logger";
import type {
  VerificationResult,
  VerifyDriverLicenseRequest,
  VerifyFacialMatchRequest,
  VerifyNinRequest,
  VerifyVehiclePlateRequest,
} from "./types";

function mockPendingResult(context: string): VerificationResult {
  logger.info({ context }, "[verification:stub] not wired to a real provider — returning pending_manual_review");
  return {
    verdict: "pending_manual_review",
    reference: `manual_review_${Date.now()}`,
    provider: "none",
    message: "Automated identity verification is not configured. Routed to manual admin review.",
    checkedAt: new Date().toISOString(),
  };
}

export const verificationProvider = {
  async verifyNIN(_req: VerifyNinRequest): Promise<VerificationResult> {
    return mockPendingResult("verifyNIN");
  },

  async verifyDriverLicense(_req: VerifyDriverLicenseRequest): Promise<VerificationResult> {
    return mockPendingResult("verifyDriverLicense");
  },

  async verifyVehiclePlate(_req: VerifyVehiclePlateRequest): Promise<VerificationResult> {
    return mockPendingResult("verifyVehiclePlate");
  },

  async verifyFacialMatch(_req: VerifyFacialMatchRequest): Promise<VerificationResult> {
    return mockPendingResult("verifyFacialMatch");
  },
};
