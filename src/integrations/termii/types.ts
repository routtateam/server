// Types mirroring Termii's actual REST API contract (https://developers.termii.com).
// Only the fields this backend uses are modelled — extend as needed.

export interface TermiiSendMessageRequest {
  to: string; // E.164 phone number, e.g. "2348031234567"
  from: string; // Sender ID, alphanumeric, registered with Termii
  sms: string;
  type: "plain";
  channel: "generic" | "dnd" | "whatsapp";
  api_key?: string; // injected by the adapter, never by callers
}

export interface TermiiSendMessageResponse {
  message_id: string;
  message: string;
  balance: number;
  user: string;
}

export interface TermiiSendOtpRequest {
  api_key?: string;
  message_type: "NUMERIC" | "ALPHANUMERIC";
  to: string;
  from: string;
  channel: "generic" | "dnd" | "whatsapp";
  pin_attempts: number;
  pin_time_to_live: number; // minutes
  pin_length: number;
  pin_placeholder: string; // e.g. "< 1234 >"
  message_text: string;
  pin_type: "NUMERIC" | "ALPHANUMERIC";
}

export interface TermiiSendOtpResponse {
  pinId: string;
  to: string;
  smsStatus: string;
}

export interface TermiiVerifyOtpRequest {
  api_key?: string;
  pin_id: string;
  pin: string;
}

export interface TermiiVerifyOtpResponse {
  pinId: string;
  verified: "True" | "False";
  msisdn: string;
}
