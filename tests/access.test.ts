import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, makeTrip, P, personas, tokenFor } from "./helpers";
import { db } from "@/db/knex";
import { PERMISSIONS } from "@/modules/rbac/permissions";

let p: Awaited<ReturnType<typeof personas>>;
beforeAll(async () => {
  p = await personas();
});

// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

describe("RBAC denials on new endpoints", () => {
  it("admin support/dispute reply + escalate need the right permission (support admin can reply to tickets, not resolve disputes)", async () => {
    const dispute = await db("disputes").first();
    const ticket = await db("support_tickets").first();

    // Support admin: disputes.view only -> may read, may NOT reply/escalate disputes
    expect((await api().get(`${P}/admin/disputes/${dispute.id}`).set(auth(p.supportAdminToken))).status).toBe(200);
    expect((await api().post(`${P}/admin/disputes/${dispute.id}/reply`).set(auth(p.supportAdminToken)).send({ body: "hello" })).status).toBe(403);
    expect((await api().post(`${P}/admin/disputes/${dispute.id}/escalate`).set(auth(p.supportAdminToken)).send({})).status).toBe(403);
    // ...but has support.manage for tickets
    expect((await api().post(`${P}/admin/support/${ticket.id}/reply`).set(auth(p.supportAdminToken)).send({ body: "We are checking your payout." })).status).toBe(201);

    // An admin with no permissions at all is refused everywhere
    const nobody = tokenFor(p.admin, { permissions: [] });
    for (const [m, u] of [
      ["get", `${P}/admin/disputes/${dispute.id}`],
      ["post", `${P}/admin/disputes/${dispute.id}/reply`],
      ["get", `${P}/admin/support/${ticket.id}`],
      ["post", `${P}/admin/support/${ticket.id}/reply`],
      ["post", `${P}/admin/support/${ticket.id}/escalate`],
    ] as const) {
      expect((await (api() as any)[m](u).set(auth(nobody)).send({ body: "x" })).status).toBe(403);
    }
    // Non-admin personas cannot use admin endpoints
    for (const t of [p.commuterToken, p.driverToken, p.bizToken]) {
      expect([401, 403]).toContain((await api().post(`${P}/admin/support/${ticket.id}/reply`).set(auth(t)).send({ body: "x" })).status);
    }
  });

  it("driver-only endpoints refuse commuters, admins and businesses", async () => {
    for (const url of [`${P}/drivers/me/payout-account`, `${P}/drivers/me/settings`, `${P}/drivers/me/dashboard`]) {
      expect((await api().get(url)).status).toBe(401);
      for (const t of [p.commuterToken, p.adminToken, p.bizToken]) expect([401, 403]).toContain((await api().get(url).set(auth(t))).status);
    }
    const trip = await makeTrip(p, "in_progress");
    // end-early is driver-only
    expect([401, 403]).toContain((await api().post(`${P}/trips/${trip.id}/end-early`).set(auth(p.commuterToken)).send({})).status);
    // commuter-only
    expect([401, 403]).toContain((await api().delete(`${P}/users/me`).set(auth(p.driverToken))).status);
    expect([401, 403]).toContain((await api().get(`${P}/trips/scheduled`).set(auth(p.driverToken))).status);
  });

  it("trip data is not readable by an unrelated driver or a business token", async () => {
    const [other] = await db("users").insert({ user_type: "driver", first_name: "Other", last_name: "Driver", phone: "+2348037770001", status: "active" }).returning("*");
    const trip = await makeTrip(p, "accepted");
    expect((await api().get(`${P}/trips/${trip.id}`).set(auth(tokenFor(other)))).status).toBe(403);
    expect((await api().get(`${P}/trips/${trip.id}`).set(auth(p.bizToken))).status).toBe(403);
    expect((await api().get(`${P}/trips/${trip.id}`).set(auth(tokenFor(p.admin, { permissions: [] })))).status).toBe(403);
    expect((await api().get(`${P}/trips/${trip.id}`).set(auth(tokenFor(p.admin, { permissions: [...PERMISSIONS] })))).status).toBe(200);
  });

  it("commuter/driver support endpoints are scoped to the requester", async () => {
    const created = await api().post(`${P}/support/disputes`).set(auth(p.commuterToken)).send({ title: "Wrong route taken", kind: "route", description: "The driver took a long way round." });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.slaDueAt).toBeTruthy();
    expect(created.body.data.messages).toHaveLength(1);
    expect((await api().get(`${P}/support/disputes/${id}`).set(auth(p.driverToken))).status).toBe(404); // someone else's
    expect((await api().post(`${P}/support/disputes/${id}/messages`).set(auth(p.driverToken)).send({ body: "hi" })).status).toBe(404);
    expect((await api().get(`${P}/support/disputes`).set(auth(p.adminToken))).status).toBe(401);
  });
});

describe("commuter/driver support: create, list, message, admin reply + escalate", () => {
  it("full thread round trip with admin names, escalation and SLA fields", async () => {
    const created = await api().post(`${P}/support/tickets`).set(auth(p.driverToken)).send({ subject: "App keeps logging me out", body: "Every few minutes.", priority: "low" });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const msg = await api().post(`${P}/support/tickets/${id}/messages`).set(auth(p.driverToken)).send({ body: "It happened again." });
    expect(msg.status).toBe(201);
    expect(msg.body.data.messages).toHaveLength(2);

    const list = await api().get(`${P}/admin/support`).set(auth(p.adminToken));
    const row = list.body.data.find((t: any) => t.id === id);
    expect(row.requester_name).toBe("Chinedu Okafor");
    expect(row.requester_role).toBe("driver");
    expect(row.sla_due_at).toBeTruthy();
    expect(row.sla_status).toBe("on_track");
    expect(row.message_count).toBe(2);

    const esc = await api().post(`${P}/admin/support/${id}/escalate`).set(auth(p.adminToken)).send({ note: "Repeated session bug" });
    expect(esc.status).toBe(200);
    expect(esc.body.data.escalated).toBe(true);
    expect(esc.body.data.priority).toBe("high");

    const reply = await api().post(`${P}/admin/support/${id}/reply`).set(auth(p.adminToken)).send({ body: "Fixed in the next release." });
    expect(reply.status).toBe(201);
    expect(reply.body.data.slaStatus).toBe("met");

    const mine = await api().get(`${P}/support/tickets/${id}`).set(auth(p.driverToken));
    const last = mine.body.data.messages[mine.body.data.messages.length - 1];
    expect(last.author).toBe("support");
    expect(last.body).toBe("Fixed in the next release.");
    const notif = await db("notifications").where({ user_id: p.driver.id, title: "Routta support replied" }).first();
    expect(notif).toBeTruthy(); // inline notification (no Redis)
  });

  it("admin dispute list exposes commuter and transporter names separately", async () => {
    const res = await api().get(`${P}/admin/disputes`).set(auth(p.adminToken));
    expect(res.status).toBe(200);
    const row = res.body.data.items.find((d: any) => d.title === "Overcharged by N500");
    expect(row.commuter_name).toBe("Adaeze Nwosu");
    expect(row.transporter_name).toBe("Chinedu Okafor");
    expect(row.raised_by_role).toBe("commuter");
    expect(Number(row.trip_fare)).toBeGreaterThan(0);
    expect(row.sla_status).toBeTruthy();
  });
});

describe("driver flows", () => {
  it("public application creates a pending applicant, needs no auth, and rejects duplicates", async () => {
    const body = { firstName: "Kunle", lastName: "Ade", phone: "+2348031234567", city: "Lagos", vehicle: { category: "car", make: "Toyota", model: "Camry", plate: "ABC 123 XY", seats: 4 } };
    const res = await api().post(`${P}/auth/driver/apply`).send(body);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
    expect(res.body.data.otp.sent).toBe(true);
    const user = await db("users").where({ phone: body.phone }).first();
    expect(user.status).toBe("pending");
    const profile = await db("driver_profiles").where({ user_id: user.id }).first();
    expect(profile.verified).toBe(false);
    expect(await db("vehicles").where({ driver_id: user.id })).toHaveLength(1);

    expect((await api().post(`${P}/auth/driver/apply`).send(body)).status).toBe(409);
    expect((await api().post(`${P}/auth/driver/apply`).send({ firstName: "X" })).status).toBe(422);
  });

  it("decline persists: hidden from incoming, acceptance rate recomputed, idempotent", async () => {
    await db("driver_profiles").where({ user_id: p.driver.id }).update({ offers_accepted: 10, offers_declined: 1 });
    const trip = await makeTrip(p, "matching");
    const before = await api().get(`${P}/trips/incoming`).set(auth(p.driverToken));
    expect(before.body.data.some((t: any) => t.id === trip.id)).toBe(true);

    const dec = await api().post(`${P}/trips/${trip.id}/decline`).set(auth(p.driverToken)).send({ reason: "Too far" });
    expect(dec.status).toBe(200);
    expect(dec.body.data.acceptanceRate).toBe(83); // 10 / 12
    const again = await api().post(`${P}/trips/${trip.id}/decline`).set(auth(p.driverToken)).send({});
    expect(again.body.data.acceptanceRate).toBe(83); // not double counted

    const after = await api().get(`${P}/trips/incoming`).set(auth(p.driverToken));
    expect(after.body.data.some((t: any) => t.id === trip.id)).toBe(false);
    const me = await api().get(`${P}/drivers/me`).set(auth(p.driverToken));
    expect(Math.round(me.body.data.acceptanceRate)).toBe(83);
    await db("driver_profiles").where({ user_id: p.driver.id }).update({ offers_accepted: 10, offers_declined: 1, acceptance_rate: 90.91 });
  });

  it("payout bank account get/set, and cash-out uses it", async () => {
    const put = await api().put(`${P}/drivers/me/payout-account`).set(auth(p.driverToken)).send({ bankName: "Access Bank", bankCode: "044", accountNumber: "0987654321", accountName: "Chinedu Okafor" });
    expect(put.status).toBe(200);
    expect(put.body.data.accountNumberMasked).toBe("•••4321");
    expect(JSON.stringify(put.body)).not.toContain("0987654321");
    expect((await api().put(`${P}/drivers/me/payout-account`).set(auth(p.driverToken)).send({ bankName: "X", accountNumber: "123", accountName: "A" })).status).toBe(422);

    const bal = await api().get(`${P}/drivers/me/earnings/balance`).set(auth(p.driverToken));
    expect(bal.body.data.bank.bankName).toBe("Access Bank");
    const q = await api().post(`${P}/drivers/me/payouts/quote`).set(auth(p.driverToken)).send({ amount: 100000 });
    expect(q.body.data.net).toBe(95000);
    expect(q.body.data.bank.accountNumberLast4).toBe("4321");
  });

  it("online sessions, yesterday + aggregate figures and per-bucket earnings series", async () => {
    await api().patch(`${P}/drivers/me/status`).set(auth(p.driverToken)).send({ online: false }).expect(200);
    expect(await db("driver_online_sessions").where({ driver_id: p.driver.id }).whereNull("ended_at")).toHaveLength(0);
    await api().patch(`${P}/drivers/me/status`).set(auth(p.driverToken)).send({ online: true }).expect(200);
    await api().patch(`${P}/drivers/me/status`).set(auth(p.driverToken)).send({ online: true }).expect(200); // no duplicate open session
    expect(await db("driver_online_sessions").where({ driver_id: p.driver.id }).whereNull("ended_at")).toHaveLength(1);

    const dash = await api().get(`${P}/drivers/me/dashboard`).set(auth(p.driverToken));
    expect(dash.status).toBe(200);
    expect(dash.body.data.yesterdayEarned).toBeGreaterThan(0); // seeded yesterday trip
    expect(dash.body.data.yesterdayTrips).toBeGreaterThan(0);
    expect(typeof dash.body.data.onlineDuration).toBe("string");

    const y = await api().get(`${P}/drivers/me/earnings`).query({ period: "yesterday" }).set(auth(p.driverToken));
    expect(y.body.data.onlineSeconds).toBeGreaterThan(6 * 3600); // seeded 7h session
    expect(y.body.data.series).toHaveLength(24);

    const w = await api().get(`${P}/drivers/me/earnings`).query({ period: "week" }).set(auth(p.driverToken));
    expect(w.body.data.series).toHaveLength(7);
    expect(w.body.data.series.reduce((s: number, b: any) => s + b.amount, 0)).toBe(w.body.data.total);
    const m = await api().get(`${P}/drivers/me/earnings`).query({ period: "month" }).set(auth(p.driverToken));
    expect(m.body.data.series.reduce((s: number, b: any) => s + b.amount, 0)).toBe(m.body.data.total);
    const t = await api().get(`${P}/drivers/me/earnings`).query({ period: "today" }).set(auth(p.driverToken));
    expect(t.body.data.series.reduce((s: number, b: any) => s + b.amount, 0)).toBe(t.body.data.total);
  });

  it("driver settings get/update", async () => {
    const before = await api().get(`${P}/drivers/me/settings`).set(auth(p.driverToken));
    expect(before.body.data.voiceNavigation).toBe(true);
    const upd = await api().patch(`${P}/drivers/me/settings`).set(auth(p.driverToken)).send({ autoAcceptNearby: true, navigationApp: "Waze" });
    expect(upd.status).toBe(200);
    expect(upd.body.data.autoAcceptNearby).toBe(true);
    expect(upd.body.data.navigationApp).toBe("Waze");
    expect(upd.body.data.voiceNavigation).toBe(true);
    expect((await api().patch(`${P}/drivers/me/settings`).set(auth(p.driverToken)).send({ bogus: true })).status).toBe(422);
  });

  it("multipart document upload: stored, status stays pending, private to owner/admin; junk is refused", async () => {
    const ok = await api().post(`${P}/drivers/me/documents/address/upload`).set(auth(p.driverToken)).attach("file", PNG, { filename: "../../evil.php", contentType: "image/png" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe("pending");
    const doc = await db("documents").where({ owner_id: p.driver.id, doc_key: "address" }).first();
    expect(doc.file_url).toMatch(/\/files\/documents\/.+\.png$/);
    expect(doc.file_url).not.toContain("evil");

    expect((await api().get(doc.file_url).set(auth(p.driverToken))).status).toBe(200);
    expect((await api().get(doc.file_url).set(auth(p.adminToken))).status).toBe(200);
    expect([401, 403]).toContain((await api().get(doc.file_url).set(auth(p.commuterToken))).status);
    expect((await api().get(doc.file_url)).status).toBe(401);
    const [other] = await db("users").insert({ user_type: "driver", first_name: "Nosy", last_name: "Driver", phone: "+2348037770002", status: "active" }).returning("*");
    expect((await api().get(doc.file_url).set(auth(tokenFor(other)))).status).toBe(403);

    const junk = await api().post(`${P}/drivers/me/documents/address/upload`).set(auth(p.driverToken)).attach("file", Buffer.from("<?php echo 1;"), { filename: "x.png", contentType: "image/png" });
    expect(junk.status).toBe(422);
    expect((await api().post(`${P}/drivers/me/documents/address/upload`).set(auth(p.driverToken))).status).toBe(422);
  });
});

describe("commuter smaller features", () => {
  it("place search / reverse geocoding from the seeded catalogue", async () => {
    const res = await api().get(`${P}/places/search`).query({ q: "ikeja" }).set(auth(p.commuterToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(1);
    expect(res.body.data[0]).toMatchObject({ kind: "search" });
    expect(typeof res.body.data[0].lat).toBe("number");
    const air = await api().get(`${P}/places/search`).query({ q: "airport" }).set(auth(p.commuterToken));
    expect(air.body.data.some((x: any) => /airport/i.test(x.label))).toBe(true);
    expect((await api().get(`${P}/places/search`).query({ q: "a" }).set(auth(p.commuterToken))).body.data).toEqual([]);
    const rev = await api().get(`${P}/places/reverse`).query({ lat: 6.6018, lng: 3.3515 }).set(auth(p.commuterToken));
    expect(rev.body.data.label).toMatch(/Ikeja City Mall|Allen/);
    expect((await api().get(`${P}/places/search`).query({ q: "ikeja" })).status).toBe(401);
  });

  it("scheduled rides: create, list, cancel (idempotent), ownership enforced", async () => {
    const when = new Date(Date.now() + 26 * 3600_000).toISOString();
    const body = { pickup: { label: "Home", lat: 6.43, lng: 3.42 }, destination: { label: "Airport", lat: 6.57, lng: 3.32 }, category: "car", scheduledFor: when, fare: 310000 };
    const created = await api().post(`${P}/trips/scheduled`).set(auth(p.commuterToken)).send(body);
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    const list = await api().get(`${P}/trips/scheduled`).set(auth(p.commuterToken));
    expect(list.body.data.some((r: any) => r.id === id)).toBe(true);
    expect((await api().post(`${P}/trips/scheduled`).set(auth(p.commuterToken)).send({ ...body, scheduledFor: new Date(Date.now() + 60_000).toISOString() })).status).toBe(422);

    const otherCommuter = tokenFor((await db("users").where({ email: "tobi.adeyemi@example.com" }).first()));
    expect((await api().post(`${P}/trips/scheduled/${id}/cancel`).set(auth(otherCommuter))).status).toBe(404);
    expect((await api().post(`${P}/trips/scheduled/${id}/cancel`).set(auth(p.commuterToken))).body.data.status).toBe("cancelled");
    expect((await api().post(`${P}/trips/scheduled/${id}/cancel`).set(auth(p.commuterToken))).status).toBe(200);
    const after = await api().get(`${P}/trips/scheduled`).set(auth(p.commuterToken));
    expect(after.body.data.some((r: any) => r.id === id)).toBe(false);
  });

  it("promo code on trip request: discount computed server-side, cancel fee + reason exposed", async () => {
    const res = await api().post(`${P}/trips`).set(auth(p.commuterToken)).send({
      pickup: { label: "A", lat: 6.43, lng: 3.42 }, destination: { label: "B", lat: 6.6, lng: 3.35 }, category: "car", fare: 250000, distanceKm: 10, promoCode: "welcome20",
    });
    expect(res.status).toBe(201);
    expect(res.body.data.promoCode).toBe("WELCOME20");
    expect(res.body.data.promoDiscount).toBe(50000);
    expect(res.body.data.fare).toBe(200000);
    expect((await api().post(`${P}/trips`).set(auth(p.commuterToken)).send({
      pickup: { label: "A", lat: 6.43, lng: 3.42 }, destination: { label: "B", lat: 6.6, lng: 3.35 }, category: "car", fare: 250000, distanceKm: 10, promoCode: "NOPE",
    })).status).toBe(422);

    // late cancellation (driver already arrived) charges the fee and exposes reason + who cancelled
    const trip = await makeTrip(p, "arrived", 200000);
    const cancelled = await api().post(`${P}/trips/${trip.id}/cancel`).set(auth(p.commuterToken)).send({ reason: "Changed my mind" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.cancelFee).toBe(30000);
    expect(cancelled.body.data.cancelReason).toBe("Changed my mind");
    expect(cancelled.body.data.cancelledBy).toBe("commuter");
    const early = await makeTrip(p, "matching", 200000);
    expect((await api().post(`${P}/trips/${early.id}/cancel`).set(auth(p.commuterToken)).send({})).body.data.cancelFee).toBe(0);
  });

  it("delete account: soft delete + anonymise, blocked while money or a ride is outstanding", async () => {
    const [u] = await db("users").insert({ user_type: "commuter", first_name: "Temp", last_name: "Person", email: "temp.person@example.com", phone: "+2348035550000", status: "active" }).returning("*");
    await db("wallets").insert({ user_id: u.id, balance: 5000 });
    await db("saved_places").insert({ user_id: u.id, label: "Home", lat: 6.4, lng: 3.4, kind: "home" });
    const token = tokenFor(u);
    expect((await api().delete(`${P}/users/me`).set(auth(token))).status).toBe(422); // wallet not empty
    await db("wallets").where({ user_id: u.id }).update({ balance: 0 });
    const del = await api().delete(`${P}/users/me`).set(auth(token));
    expect(del.status).toBe(200);

    const row = await db("users").where({ id: u.id }).first();
    expect(row.deleted_at).not.toBeNull();
    expect(row.phone).toBeNull();
    expect(row.email).not.toContain("temp.person");
    expect(row.first_name).toBe("Deleted");
    expect(await db("saved_places").where({ user_id: u.id })).toHaveLength(0);
    expect((await api().get(`${P}/users/me`).set(auth(token))).status).toBe(404);
  });
});
