import { db } from "@/db/knex";
import { NotFoundError, ValidationError } from "@/common/utils/errors";
import { fullName } from "@/common/utils/dto";
import { dispatchNotification } from "@/jobs/dispatch";
import { DISPUTE_SLA_HOURS, ESCALATED_SLA_HOURS, TICKET_SLA_HOURS, dueAt, slaInfo } from "./support.sla";

function messageDto(m: any) {
  return { id: m.id, author: m.author_role === "support" ? "support" : "you", body: m.body, time: m.created_at };
}

function disputeDto(d: any, messages: any[], extra: Record<string, unknown> = {}) {
  const last = messages[messages.length - 1];
  return {
    id: d.id,
    tripId: d.trip_id,
    title: d.title,
    kind: d.kind,
    status: d.status as "under_review" | "resolved",
    escalated: d.escalated,
    amount: Number(d.amount),
    description: d.description ?? null,
    resolutionNote: d.resolution_note ?? null,
    openedAt: d.created_at,
    lastUpdate: last?.created_at ?? d.updated_at,
    ...slaInfo(d, d.status === "resolved"),
    messages: messages.map(messageDto),
    ...extra,
  };
}

function ticketDto(t: any, messages: any[]) {
  const last = messages[messages.length - 1];
  return {
    id: t.id,
    subject: t.subject,
    status: t.status as "open" | "pending" | "resolved" | "closed",
    priority: t.priority,
    channel: t.channel,
    relatedTripId: t.related_trip_id,
    escalated: t.escalated,
    openedAt: t.created_at,
    lastUpdate: last?.created_at ?? t.updated_at,
    ...slaInfo(t, ["resolved", "closed"].includes(t.status)),
    messages: messages.map(messageDto),
  };
}

async function tripInvolving(userId: string, tripId: string) {
  const trip = await db("trips").where({ id: tripId }).first();
  if (!trip || (trip.commuter_id !== userId && trip.driver_id !== userId)) throw new NotFoundError("Trip not found");
  return trip;
}

async function groupMessages(table: "dispute_messages" | "ticket_messages", fk: "dispute_id" | "ticket_id", ids: string[]) {
  const map = new Map<string, any[]>();
  if (!ids.length) return map;
  const rows = await db(table).whereIn(fk, ids).orderBy("created_at", "asc");
  for (const r of rows) map.set(r[fk], [...(map.get(r[fk]) ?? []), r]);
  return map;
}

/** Requester-facing (commuter or driver) disputes and support tickets. Ownership is enforced on every call. */
export const supportService = {
  // ---- Disputes ----
  async createDispute(userId: string, input: { tripId?: string; title: string; kind: string; description: string; amount?: number }) {
    if (input.tripId) await tripInvolving(userId, input.tripId);
    const hours = input.kind === "safety" ? DISPUTE_SLA_HOURS.safety : DISPUTE_SLA_HOURS.default;
    const dispute = await db.transaction(async (trx) => {
      const [d] = await trx("disputes")
        .insert({
          trip_id: input.tripId ?? null,
          raised_by: userId,
          title: input.title,
          kind: input.kind,
          amount: input.amount ?? 0,
          description: input.description,
          sla_due_at: dueAt(new Date(), hours),
        })
        .returning("*");
      await trx("dispute_messages").insert({ dispute_id: d.id, author_id: userId, author_role: "you", body: input.description });
      return d;
    });
    return this.getDispute(userId, dispute.id);
  },

  async listDisputes(userId: string) {
    const rows = await db("disputes").where({ raised_by: userId }).orderBy("created_at", "desc").limit(100);
    const msgs = await groupMessages("dispute_messages", "dispute_id", rows.map((r) => r.id));
    return rows.map((d) => disputeDto(d, msgs.get(d.id) ?? []));
  },

  async getDispute(userId: string, id: string) {
    const d = await db("disputes").where({ id, raised_by: userId }).first();
    if (!d) throw new NotFoundError("Dispute not found");
    const msgs = await db("dispute_messages").where({ dispute_id: id }).orderBy("created_at", "asc");
    return disputeDto(d, msgs);
  },

  async postDisputeMessage(userId: string, id: string, body: string) {
    const d = await db("disputes").where({ id, raised_by: userId }).first();
    if (!d) throw new NotFoundError("Dispute not found");
    if (d.status === "resolved") throw new ValidationError("This dispute is resolved. Open a new dispute if the problem continues.");
    await db("dispute_messages").insert({ dispute_id: id, author_id: userId, author_role: "you", body });
    await db("disputes").where({ id }).update({ updated_at: db.fn.now() });
    return this.getDispute(userId, id);
  },

  // ---- Tickets ----
  async createTicket(userId: string, input: { subject: string; body: string; priority?: "low" | "medium" | "high"; relatedTripId?: string }) {
    if (input.relatedTripId) await tripInvolving(userId, input.relatedTripId);
    const priority = input.priority ?? "medium";
    const ticket = await db.transaction(async (trx) => {
      const [t] = await trx("support_tickets")
        .insert({
          requester_id: userId,
          subject: input.subject,
          body: input.body,
          priority,
          related_trip_id: input.relatedTripId ?? null,
          sla_due_at: dueAt(new Date(), TICKET_SLA_HOURS[priority]),
        })
        .returning("*");
      await trx("ticket_messages").insert({ ticket_id: t.id, author_id: userId, author_role: "you", body: input.body });
      return t;
    });
    return this.getTicket(userId, ticket.id);
  },

  async listTickets(userId: string) {
    const rows = await db("support_tickets").where({ requester_id: userId }).orderBy("created_at", "desc").limit(100);
    const msgs = await groupMessages("ticket_messages", "ticket_id", rows.map((r) => r.id));
    return rows.map((t) => ticketDto(t, msgs.get(t.id) ?? []));
  },

  async getTicket(userId: string, id: string) {
    const t = await db("support_tickets").where({ id, requester_id: userId }).first();
    if (!t) throw new NotFoundError("Ticket not found");
    const msgs = await db("ticket_messages").where({ ticket_id: id }).orderBy("created_at", "asc");
    return ticketDto(t, msgs);
  },

  async postTicketMessage(userId: string, id: string, body: string) {
    const t = await db("support_tickets").where({ id, requester_id: userId }).first();
    if (!t) throw new NotFoundError("Ticket not found");
    if (t.status === "closed") throw new ValidationError("This ticket is closed. Open a new ticket if you still need help.");
    await db("ticket_messages").insert({ ticket_id: id, author_id: userId, author_role: "you", body });
    // A customer reply returns a pending/resolved ticket to the support queue.
    await db("support_tickets").where({ id }).update({ status: "open", updated_at: db.fn.now() });
    return this.getTicket(userId, id);
  },
};

/** Admin side: threads with names, replies and escalation. Permission checks live on the routes. */
export const adminSupportService = {
  async disputeDetail(id: string) {
    const d = await db("disputes as d")
      .leftJoin("trips as t", "t.id", "d.trip_id")
      .leftJoin("users as r", "r.id", "d.raised_by")
      .leftJoin("users as c", "c.id", "t.commuter_id")
      .leftJoin("users as dr", "dr.id", "t.driver_id")
      .where("d.id", id)
      .select(
        "d.*",
        "t.fare as trip_fare",
        "t.promo_discount as trip_promo_discount",
        "r.first_name as r_first",
        "r.last_name as r_last",
        "r.user_type as r_type",
        "c.first_name as c_first",
        "c.last_name as c_last",
        "dr.first_name as dr_first",
        "dr.last_name as dr_last"
      )
      .first();
    if (!d) throw new NotFoundError("Dispute not found");
    const msgs = await db("dispute_messages").where({ dispute_id: id }).orderBy("created_at", "asc");
    return disputeDto(d, msgs, {
      raisedBy: { id: d.raised_by, name: fullName({ first_name: d.r_first, last_name: d.r_last }), role: d.r_type },
      commuterName: fullName({ first_name: d.c_first, last_name: d.c_last }) || null,
      transporterName: fullName({ first_name: d.dr_first, last_name: d.dr_last }) || null,
      tripFare: d.trip_fare === null || d.trip_fare === undefined ? null : Number(d.trip_fare),
      tripPromoDiscount: d.trip_promo_discount === null || d.trip_promo_discount === undefined ? null : Number(d.trip_promo_discount),
    });
  },

  async replyDispute(adminId: string, id: string, body: string) {
    const d = await db("disputes").where({ id }).first();
    if (!d) throw new NotFoundError("Dispute not found");
    await db.transaction(async (trx) => {
      await trx("dispute_messages").insert({ dispute_id: id, author_id: adminId, author_role: "support", body });
      await trx("disputes")
        .where({ id })
        .update({ updated_at: trx.fn.now(), first_response_at: d.first_response_at ?? trx.fn.now() });
    });
    await dispatchNotification({ userId: d.raised_by, title: "Update on your dispute", body: body.slice(0, 140), kind: "chat" });
    return this.disputeDetail(id);
  },

  async escalateDispute(id: string, note?: string) {
    const d = await db("disputes").where({ id }).first();
    if (!d) throw new NotFoundError("Dispute not found");
    if (d.status === "resolved") throw new ValidationError("A resolved dispute cannot be escalated.");
    await db("disputes")
      .where({ id })
      .update({
        escalated: true,
        escalated_at: d.escalated_at ?? db.fn.now(),
        sla_due_at: d.first_response_at ? d.sla_due_at : dueAt(new Date(), ESCALATED_SLA_HOURS),
        updated_at: db.fn.now(),
      });
    if (note) await db("dispute_messages").insert({ dispute_id: id, author_role: "support", body: `Escalated to senior review: ${note}` });
    return this.disputeDetail(id);
  },

  async ticketDetail(id: string) {
    const t = await db("support_tickets as t")
      .leftJoin("users as u", "u.id", "t.requester_id")
      .leftJoin("users as a", "a.id", "t.assignee_id")
      .where("t.id", id)
      .select("t.*", "u.first_name as u_first", "u.last_name as u_last", "u.user_type as u_type", "a.first_name as a_first", "a.last_name as a_last")
      .first();
    if (!t) throw new NotFoundError("Ticket not found");
    const msgs = await db("ticket_messages").where({ ticket_id: id }).orderBy("created_at", "asc");
    return {
      ...ticketDto(t, msgs),
      requester: { id: t.requester_id, name: fullName({ first_name: t.u_first, last_name: t.u_last }), role: t.u_type },
      assignee: t.assignee_id ? { id: t.assignee_id, name: fullName({ first_name: t.a_first, last_name: t.a_last }) } : null,
    };
  },

  async replyTicket(adminId: string, id: string, body: string) {
    const t = await db("support_tickets").where({ id }).first();
    if (!t) throw new NotFoundError("Ticket not found");
    if (t.status === "closed") throw new ValidationError("This ticket is closed.");
    await db.transaction(async (trx) => {
      await trx("ticket_messages").insert({ ticket_id: id, author_id: adminId, author_role: "support", body });
      await trx("support_tickets")
        .where({ id })
        .update({
          status: "pending", // waiting on the requester
          assignee_id: t.assignee_id ?? adminId,
          first_response_at: t.first_response_at ?? trx.fn.now(),
          updated_at: trx.fn.now(),
        });
    });
    await dispatchNotification({ userId: t.requester_id, title: "Routta support replied", body: body.slice(0, 140), kind: "chat" });
    return this.ticketDetail(id);
  },

  async escalateTicket(id: string, note?: string) {
    const t = await db("support_tickets").where({ id }).first();
    if (!t) throw new NotFoundError("Ticket not found");
    if (["resolved", "closed"].includes(t.status)) throw new ValidationError("A resolved ticket cannot be escalated.");
    await db("support_tickets")
      .where({ id })
      .update({
        escalated: true,
        escalated_at: t.escalated_at ?? db.fn.now(),
        priority: "high",
        sla_due_at: t.first_response_at ? t.sla_due_at : dueAt(new Date(), ESCALATED_SLA_HOURS),
        updated_at: db.fn.now(),
      });
    if (note) await db("ticket_messages").insert({ ticket_id: id, author_role: "support", body: `Escalated to senior review: ${note}` });
    return this.ticketDetail(id);
  },
};
