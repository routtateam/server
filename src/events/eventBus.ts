// Lightweight internal event bus for the modular monolith.
// Modules publish domain events here instead of calling each other directly
// (e.g. trips publishes "trip.completed"; payments/notifications subscribe).
// This keeps module coupling one-directional and gives BullMQ job
// producers a single place to hook into domain events.
import { EventEmitter } from "node:events";
import { logger } from "@/common/utils/logger";

export const DomainEvents = {
  TripCompleted: "trip.completed",
  TripCancelled: "trip.cancelled",
  TripAccepted: "trip.accepted",
  TripRequested: "trip.requested",
  DriverVerificationSubmitted: "driver.verification.submitted",
  DriverVerificationReviewed: "driver.verification.reviewed",
  PaymentInitiated: "payment.initiated",
  PaymentSucceeded: "payment.succeeded",
  PaymentFailed: "payment.failed",
  WalletTopUp: "wallet.topup",
  PayoutRequested: "payout.requested",
  PayoutProcessed: "payout.processed",
  PremiumBookingCreated: "premium_booking.created",
  PremiumBookingCompleted: "premium_booking.completed",
  UserRegistered: "user.registered",
  NotificationRequested: "notification.requested",
} as const;

export type DomainEventName = (typeof DomainEvents)[keyof typeof DomainEvents];

class TypedEventBus extends EventEmitter {
  publish<T extends object>(event: DomainEventName, payload: T): void {
    logger.debug({ event, payload }, "domain event published");
    this.emit(event, payload);
  }

  subscribe<T extends object>(event: DomainEventName, handler: (payload: T) => void | Promise<void>): void {
    this.on(event, (payload: T) => {
      Promise.resolve(handler(payload)).catch((err) =>
        logger.error({ err, event }, "domain event handler failed")
      );
    });
  }
}

/** Process-wide singleton. In-memory only — fine for a modular monolith;
 *  BullMQ (Redis-backed) is used for anything that must survive a restart
 *  or run out-of-process (see src/jobs). */
export const eventBus = new TypedEventBus();
eventBus.setMaxListeners(50);
