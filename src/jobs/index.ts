// Wires domain events (src/events/eventBus.ts) to background-job producers.
// Import this once from src/app.ts.
// NOTE: trip settlement is dispatched explicitly (awaited) from trips.service on completion, not via the
// event bus, so the completion request can guarantee "settled or enqueued" before responding.
import { eventBus, DomainEvents } from "@/events/eventBus";
import { dispatchNotification } from "./dispatch";

export function registerJobEventSubscriptions(): void {
  eventBus.subscribe<{ userId: string; title: string; body: string }>(DomainEvents.NotificationRequested, async (payload) => {
    await dispatchNotification(payload);
  });
}
