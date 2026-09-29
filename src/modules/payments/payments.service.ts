import { paymentsRepository } from "./payments.repository";
import { authRepository } from "@/modules/auth/auth.repository";
import { monnify } from "@/integrations/monnify";
import { ValidationError, NotFoundError } from "@/common/utils/errors";
import { eventBus, DomainEvents } from "@/events/eventBus";
import { v4 as uuid } from "uuid";

function toMethodDto(row: any) {
  return {
    id: row.id,
    kind: row.kind,
    brand: row.brand ?? undefined,
    last4: row.last4 ?? undefined,
    bank: row.bank ?? undefined,
    expiry: row.expiry ?? undefined,
    isDefault: row.is_default,
    expired: row.expired,
  };
}

export const paymentsService = {
  async getWalletBalance(userId: string) {
    const wallet = await paymentsRepository.ensureWallet(userId);
    return Number(wallet.balance);
  },

  async initiateTopUp(userId: string, amount: number) {
    const user = await authRepository.findById(userId);
    if (!user) throw new NotFoundError("Account not found");
    const wallet = await paymentsRepository.ensureWallet(userId);
    const reference = `RTT-TOPUP-${uuid()}`;

    const init = await monnify.initiatePayment({
      amount: amount / 100,
      customerName: `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || "Routta user",
      customerEmail: user.email ?? "no-email@routta.app",
      paymentReference: reference,
      paymentDescription: "Routta wallet top-up",
      paymentMethods: ["CARD", "ACCOUNT_TRANSFER"],
    });

    await paymentsRepository.createPendingTransaction({
      wallet_id: wallet.id,
      user_id: userId,
      type: "topup",
      amount,
      status: "pending",
      provider: "monnify",
      provider_reference: reference,
    });

    eventBus.publish(DomainEvents.PaymentInitiated, { userId, reference, amount });

    return { checkoutUrl: init.responseBody.checkoutUrl, reference, transactionReference: init.responseBody.transactionReference };
  },

  /**
   * Dev/sandbox convenience: since we don't have a real Monnify webhook
   * (no live credentials), this endpoint lets the client confirm a top-up
   * directly, mirroring what the Monnify webhook handler below would do
   * once wired to a real sandbox. In production this path would be removed
   * or gated to Monnify's own webhook signature only.
   */
  async confirmTopUp(userId: string, reference: string) {
    const txn = await paymentsRepository.findTransactionByReference(reference);
    if (!txn || txn.user_id !== userId) throw new NotFoundError("Transaction not found");
    if (txn.status === "successful") return { newBalance: await this.getWalletBalance(userId) };

    const verification = await monnify.verifyTransaction(reference);
    if (verification.responseBody.paymentStatus !== "PAID") {
      throw new ValidationError("Payment has not been completed yet.");
    }

    await paymentsRepository.markTransactionSuccessful(txn.id);
    await paymentsRepository.creditWallet(txn.wallet_id, Number(txn.amount));
    eventBus.publish(DomainEvents.PaymentSucceeded, { userId, reference, amount: Number(txn.amount) });
    eventBus.publish(DomainEvents.WalletTopUp, { userId, amount: Number(txn.amount) });

    return { newBalance: await this.getWalletBalance(userId) };
  },

  /** Monnify webhook handler stub — wire the raw Express route once real
   *  MONNIFY_WEBHOOK_SECRET + live credentials exist. */
  async handleMonnifyWebhook(rawBody: string, signatureHeader: string | undefined) {
    const payload = monnify.parseWebhook(rawBody, signatureHeader);
    if (payload.eventType !== "SUCCESSFUL_TRANSACTION") return;
    const txn = await paymentsRepository.findTransactionByReference(payload.eventData.paymentReference);
    if (!txn || txn.status === "successful") return;
    await paymentsRepository.markTransactionSuccessful(txn.id);
    await paymentsRepository.creditWallet(txn.wallet_id, Number(txn.amount));
    eventBus.publish(DomainEvents.PaymentSucceeded, { userId: txn.user_id, reference: payload.eventData.paymentReference, amount: Number(txn.amount) });
  },

  async listPaymentMethods(userId: string) {
    const rows = await paymentsRepository.listPaymentMethods(userId);
    return rows.map(toMethodDto);
  },

  /**
   * TODO(security/PCI): the commuter app currently POSTs the raw card number + CVV to this endpoint. That is NOT
   * acceptable for production. This handler deliberately stores only last4 + expiry (never the PAN or CVV, and it
   * must never log them). Replace with Monnify card tokenisation: the app opens Monnify hosted checkout / SDK
   * (card data goes straight to Monnify), Monnify returns a reusable card token via the transaction webhook, and this
   * endpoint (or the webhook) saves only { provider_ref: token, brand, last4, expiry, bank }. Then delete the
   * number/cvv fields from addCardSchema.
   */
  async addCard(userId: string, input: { number: string; expiry: string; cvv: string; makeDefault: boolean }) {
    const row = await paymentsRepository.addPaymentMethod(userId, {
      kind: "card",
      brand: "visa",
      last4: input.number.slice(-4),
      bank: "New bank",
      expiry: input.expiry,
      is_default: input.makeDefault,
      provider: "monnify",
    });
    return toMethodDto(row);
  },

  async removeCard(userId: string, id: string) {
    await paymentsRepository.removePaymentMethod(userId, id);
  },

  async listPromotions() {
    const rows = await paymentsRepository.listActivePromotions();
    return rows.map((r) => ({
      code: r.code,
      title: r.description,
      description: r.description,
      discount: r.discount_type === "percent" ? Number(r.discount_value) / 100 : Number(r.discount_value),
      validForCategory: r.category_scope !== "all" ? r.category_scope : undefined,
    }));
  },

  async applyPromo(code: string) {
    const row = await paymentsRepository.activePromoByCode(code);
    if (!row) return null;
    return {
      code: row.code,
      title: row.description,
      description: row.description,
      discount: row.discount_type === "percent" ? Number(row.discount_value) / 100 : Number(row.discount_value),
      validForCategory: row.category_scope !== "all" ? row.category_scope : undefined,
    };
  },
};
