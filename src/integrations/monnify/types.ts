// Types mirroring Monnify's actual API contract
// (https://developers.monnify.com) — only the subset this backend needs.

export interface MonnifyAuthResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: { accessToken: string; expiresIn: number };
}

export interface InitiateTransactionRequest {
  amount: number; // Naira, major units
  customerName: string;
  customerEmail: string;
  paymentReference: string;
  paymentDescription: string;
  currencyCode: "NGN";
  contractCode: string;
  redirectUrl?: string;
  paymentMethods?: Array<"CARD" | "ACCOUNT_TRANSFER" | "USSD">;
  metadata?: Record<string, unknown>;
}

export interface InitiateTransactionResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    transactionReference: string;
    paymentReference: string;
    merchantName: string;
    apiKey: string;
    enabledPaymentMethod: string[];
    checkoutUrl: string;
  };
}

export type MonnifyPaymentStatus = "PAID" | "PENDING" | "FAILED" | "EXPIRED" | "OVERPAID" | "PARTIALLY_PAID";

export interface VerifyTransactionResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    transactionReference: string;
    paymentReference: string;
    amountPaid: number;
    totalPayable: number;
    settlementAmount: number;
    paidOn: string;
    paymentStatus: MonnifyPaymentStatus;
    paymentMethod: string;
    currency: "NGN";
    customer: { email: string; name: string };
  };
}

export interface InitiateTransferRequest {
  amount: number;
  reference: string;
  narration: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  currency: "NGN";
  sourceAccountNumber?: string;
}

export interface InitiateTransferResponse {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: {
    reference: string;
    status: "SUCCESS" | "PENDING" | "FAILED";
    amount: number;
    dateCreated: string;
  };
}

/** Shape of Monnify's transaction-completed webhook payload. */
export interface MonnifyWebhookPayload {
  eventType: "SUCCESSFUL_TRANSACTION" | "SUCCESSFUL_DISBURSEMENT" | "FAILED_DISBURSEMENT";
  eventData: {
    product: { type: string };
    transactionReference: string;
    paymentReference: string;
    amountPaid: string;
    totalPayable: string;
    paidOn: string;
    paymentStatus: MonnifyPaymentStatus;
    paymentMethod: string;
    currency: "NGN";
    customer: { email: string; name: string };
  };
}
