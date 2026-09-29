// Types mirroring Resend's actual API contract (https://resend.com/docs/api-reference/emails/send-email).

export interface SendEmailRequest {
  from?: string; // defaults to env.resend.fromEmail
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailResponse {
  id: string;
}
