import { db } from "@/db/knex";
import { NotFoundError, ValidationError } from "@/common/utils/errors";

const MIN_LEAD_MS = 10 * 60_000;

function toScheduledDto(r: any) {
  return {
    id: r.id,
    pickup: { label: r.pickup_label, lat: Number(r.pickup_lat), lng: Number(r.pickup_lng) },
    destination: { label: r.destination_label, lat: Number(r.destination_lat), lng: Number(r.destination_lng) },
    category: r.category,
    scheduledFor: r.scheduled_for,
    fare: r.fare_estimate === null ? null : Number(r.fare_estimate),
    promoCode: r.promo_code ?? null,
    paymentMethodId: r.payment_method_id ?? null,
    note: r.note ?? null,
    status: r.status,
    tripId: r.trip_id ?? null,
    createdAt: r.created_at,
  };
}

// NOTE: this stores the booking intent. A dispatcher that turns due rides into live `trips` (matching) is not
// implemented yet — scheduled rides stay `scheduled` until cancelled.
export const scheduledRidesService = {
  async create(commuterId: string, input: any) {
    const when = new Date(input.scheduledFor);
    if (when.getTime() < Date.now() + MIN_LEAD_MS) throw new ValidationError("Schedule a ride at least 10 minutes from now.");
    const [row] = await db("scheduled_rides")
      .insert({
        commuter_id: commuterId,
        category: input.category,
        pickup_label: input.pickup.label,
        pickup_lat: input.pickup.lat,
        pickup_lng: input.pickup.lng,
        destination_label: input.destination.label,
        destination_lat: input.destination.lat,
        destination_lng: input.destination.lng,
        scheduled_for: when,
        fare_estimate: input.fare ?? null,
        payment_method_id: input.paymentMethodId ?? null,
        promo_code: input.promoCode ?? null,
        note: input.note ?? null,
      })
      .returning("*");
    return toScheduledDto(row);
  },

  async list(commuterId: string) {
    const rows = await db("scheduled_rides")
      .where({ commuter_id: commuterId, status: "scheduled" })
      .andWhere("scheduled_for", ">=", db.raw("now() - interval '1 hour'"))
      .orderBy("scheduled_for", "asc");
    return rows.map(toScheduledDto);
  },

  async cancel(commuterId: string, id: string) {
    const [row] = await db("scheduled_rides")
      .where({ id, commuter_id: commuterId })
      .whereIn("status", ["scheduled"])
      .update({ status: "cancelled", updated_at: db.fn.now() })
      .returning("*");
    if (!row) {
      const existing = await db("scheduled_rides").where({ id, commuter_id: commuterId }).first();
      if (!existing) throw new NotFoundError("Scheduled ride not found");
      return toScheduledDto(existing); // already cancelled/dispatched: idempotent
    }
    return toScheduledDto(row);
  },
};
