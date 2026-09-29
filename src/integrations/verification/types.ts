// Stub types for a future identity-verification provider adapter.
// NOT wired to any real vendor — see README.md before implementing.

export type VerificationVerdict = "pending_manual_review" | "approved" | "rejected";

export interface VerificationResult {
  verdict: VerificationVerdict;
  reference: string;
  provider: "none";
  message: string;
  checkedAt: string;
}

export interface VerifyNinRequest {
  nin: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string; // YYYY-MM-DD
}

export interface VerifyDriverLicenseRequest {
  licenseNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
}

export interface VerifyVehiclePlateRequest {
  plateNumber: string;
  ownerName?: string;
}

export interface VerifyFacialMatchRequest {
  selfieImageUrl: string;
  idImageUrl: string;
}
