import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, auth, P, personas, tokenFor } from "./helpers";
import { db } from "@/db/knex";
import { computeDepositOutcome } from "@/modules/premium-business/premium.deposit";
import { localDateString, addDays } from "@/common/utils/time";

let p: Awaited<ReturnType<typeof personas>>;
let vehicle: any;
let tiers: any[];
const PB = `${P}/premium-business`;
const futureDate = (n: number) => localDateString(addDays(new Date(), n));

beforeAll(async () => {
  p = await personas();
  vehicle = await db("premium_vehicles").where({ name: "Toyota Land Cruiser V8" }).first();
  tiers = await db("premium_tiers").where({ vehicle_id: vehicle.id }).orderBy("price", "asc");
});

afterAll(async () => {
  await db("businesses").where({ id: p.business.id }).update({ booking_mode: "instant" });
});

const book = (date: string, tierId = tiers[0].id) =>
  api().post(`${P}/premium/bookings`).set(auth(p.commuterToken)).send({ vehicleId: vehicle.id, tierId, date, startTime: "09:00" });

/** Inserts a booking (+deposit row) directly, for scenarios that need "today" or a specific status. */
async function insertBooking(status: string, dayOffset = 0, priceKobo = 10000000) {
  const deposit = Math.round((priceKobo * 0.4) / 100) * 100;
  const [b] = await db("premium_bookings")
    .insert({
      vehicle_id: vehicle.id,
      tier_id: tiers[0].id,
      business_id: p.business.id,
      commuter_id: p.commuter.id,
      booking_date: futureDate(dayOffset),
      start_time: "10:00",
      duration_hours: 4,
      status,
      deposit,
      service_fee: 0,
      total: priceKobo + deposit,
      commission_pct: 20,
    })
    .returning("*");
  await db("protection_deposits").insert({ booking_id: b.id, held_amount: deposit });
  return { booking: b, deposit };
}

describe("deposit maths (pure)", () => {
  it("full refund when there is no claim", () => {
    expect(computeDepositOutcome(4000000, 0, 0)).toEqual({ claimAmount: 0, refundAmount: 4000000, status: "refunded" });
  });
  it("partial claim: refund = held - claim, pending Routta review", () => {
    expect(computeDepositOutcome(4000000, 1500000, 2)).toEqual({ claimAmount: 1500000, refundAmount: 2500000, status: "disputed" });
  });
  it("claim is capped at the held deposit", () => {
    expect(computeDepositOutcome(4000000, 9000000, 1)).toEqual({ claimAmount: 4000000, refundAmount: 0, status: "disputed" });
  });
  it("rejects a claim with no issue marked, and negative / fractional amounts", () => {
    expect(() => computeDepositOutcome(4000000, 100, 0)).toThrow();
    expect(() => computeDepositOutcome(4000000, -1, 1)).toThrow();
    expect(() => computeDepositOutcome(4000000, 10.5, 1)).toThrow();
  });
});

describe("booking mode: instant (default) vs request", () => {
  it("instant mode keeps the legacy behaviour: booking is confirmed immediately", async () => {
    await db("businesses").where({ id: p.business.id }).update({ booking_mode: "instant" });
    const res = await book(futureDate(30));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("confirmed");
    const dep = await db("protection_deposits").where({ booking_id: res.body.data.id }).first();
    expect(Number(dep.held_amount)).toBe(res.body.data.deposit);
  });

  it("partner can switch to request mode; new bookings then wait for acceptance", async () => {
    const set = await api().patch(`${PB}/settings`).set(auth(p.bizToken)).send({ bookingMode: "request" });
    expect(set.status).toBe(200);
    expect(set.body.data.bookingMode).toBe("request");

    const res = await book(futureDate(31));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("requested");
    expect(res.body.data.respondBy).toBeTruthy();
  });
});

describe("partner accept / decline / list requests / timeline", () => {
  it("lists pending requests with customer info and money breakdown", async () => {
    const created = await book(futureDate(32));
    const list = await api().get(`${PB}/bookings/requests`).set(auth(p.bizToken));
    expect(list.status).toBe(200);
    const row = list.body.data.find((b: any) => b.id === created.body.data.id);
    expect(row).toBeTruthy();
    expect(row.customer.name).toBe("Adaeze N.");
    expect(row.status).toBe("requested");
    expect(row.commissionPct).toBe(20);
    expect(row.rentalAmount - row.commissionAmount).toBe(row.netAmount);
    expect(row.expiresInMinutes).toBeGreaterThan(0);
    // seeded pending request is also there
    expect(list.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("accept -> confirmed, event on the timeline, idempotent, and reachable by short reference", async () => {
    const created = await book(futureDate(33));
    const id = created.body.data.id;
    const ref = `PR-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    const acc = await api().post(`${PB}/bookings/${ref}/accept`).set(auth(p.bizToken));
    expect(acc.status).toBe(200);
    expect(acc.body.data.status).toBe("confirmed");
    expect((await api().post(`${PB}/bookings/${id}/accept`).set(auth(p.bizToken))).status).toBe(200);

    const tl = await api().get(`${PB}/bookings/${id}/timeline`).set(auth(p.bizToken));
    expect(tl.status).toBe(200);
    const kinds = tl.body.data.map((s: any) => s.key);
    expect(kinds).toContain("requested");
    expect(kinds).toContain("accepted");
    expect(tl.body.data.find((s: any) => s.state === "now").key).toBe("handover");

    const one = await api().get(`${PB}/bookings/${id}`).set(auth(p.bizToken));
    expect(one.body.data.status).toBe("confirmed");
    expect(one.body.data.acceptedAt).toBeTruthy();
  });

  it("decline needs a reason, records it, and cannot be applied to a confirmed booking", async () => {
    const created = await book(futureDate(34));
    const id = created.body.data.id;
    expect((await api().post(`${PB}/bookings/${id}/decline`).set(auth(p.bizToken)).send({})).status).toBe(422);

    const dec = await api().post(`${PB}/bookings/${id}/decline`).set(auth(p.bizToken)).send({ reason: "Vehicle in the workshop" });
    expect(dec.status).toBe(200);
    expect(dec.body.data.status).toBe("declined");
    expect(dec.body.data.declineReason).toBe("Vehicle in the workshop");
    const dep = await db("protection_deposits").where({ booking_id: id }).first();
    expect(dep.status).toBe("refunded");

    const conf = await insertBooking("confirmed", 40);
    expect((await api().post(`${PB}/bookings/${conf.booking.id}/decline`).set(auth(p.bizToken)).send({ reason: "Too late" })).status).toBe(422);
  });

  it("an expired request cannot be accepted", async () => {
    const created = await book(futureDate(35));
    await db("premium_bookings").where({ id: created.body.data.id }).update({ respond_by: db.raw("now() - interval '1 minute'") });
    const res = await api().post(`${PB}/bookings/${created.body.data.id}/accept`).set(auth(p.bizToken));
    expect(res.status).toBe(422);
    const row = await db("premium_bookings").where({ id: created.body.data.id }).first();
    expect(row.status).toBe("expired");
  });
});

describe("return inspection and deposit claim", () => {
  it("no issues -> booking completed and deposit refunded in full", async () => {
    const { booking, deposit } = await insertBooking("active");
    const res = await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Exterior: "ok", Interior: "ok" }, photos: ["https://cdn.example.com/a.jpg"] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "completed", issueCount: 0, claimAmount: 0, refundAmount: deposit, depositStatus: "refunded", depositHeld: deposit });
  });

  it("issue + claim: refund = held - claim, awaiting Routta review", async () => {
    const { booking, deposit } = await insertBooking("active");
    const res = await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Exterior: "ok", Interior: "issue" }, note: "Stain", claimAmount: 1500000 });
    expect(res.status).toBe(201);
    expect(res.body.data.claimAmount).toBe(1500000);
    expect(res.body.data.refundAmount).toBe(deposit - 1500000);
    expect(res.body.data.depositStatus).toBe("disputed");
    const dep = await db("protection_deposits").where({ booking_id: booking.id }).first();
    expect(Number(dep.claim_amount) + Number(dep.refund_amount)).toBe(deposit);
    const events = await db("booking_events").where({ booking_id: booking.id }).pluck("kind");
    expect(events).toEqual(expect.arrayContaining(["returned", "inspected", "completed"]));
  });

  it("a claim above the held deposit is capped at the deposit", async () => {
    const { booking, deposit } = await insertBooking("active");
    const res = await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Body: "issue" }, claimAmount: 999999999 });
    expect(res.body.data.claimAmount).toBe(deposit);
    expect(res.body.data.refundAmount).toBe(0);
  });

  it("rejects a claim with no issue, unsafe photo URLs, and a second inspection", async () => {
    const { booking } = await insertBooking("active");
    expect((await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Exterior: "ok" }, claimAmount: 5000 })).status).toBe(422);
    expect((await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Exterior: "ok" }, photos: ["javascript:alert(1)"] })).status).toBe(422);
    expect((await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Exterior: "ok" } })).status).toBe(201);
    expect((await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Exterior: "ok" } })).status).toBe(409);
  });

  it("cannot inspect a rental that has not started yet", async () => {
    const { booking } = await insertBooking("confirmed", 20);
    expect((await api().post(`${PB}/bookings/${booking.id}/inspection`).set(auth(p.bizToken)).send({ items: { Exterior: "ok" } })).status).toBe(422);
  });
});

describe("vehicles, tiers, availability, earnings", () => {
  it("GET single vehicle and 404 for another business's / unknown vehicle", async () => {
    const ok = await api().get(`${PB}/vehicles/${vehicle.id}`).set(auth(p.bizToken));
    expect(ok.status).toBe(200);
    expect(ok.body.data.tiers.length).toBe(3);
    expect((await api().get(`${PB}/vehicles/00000000-0000-4000-8000-000000000000`).set(auth(p.bizToken))).status).toBe(404);
  });

  it("per-tier price update recomputes the vehicle's from-price; foreign tier ids are refused", async () => {
    const res = await api().put(`${PB}/vehicles/${vehicle.id}/tiers`).set(auth(p.bizToken)).send({ tiers: [{ id: tiers[0].id, price: 9000000 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.tiers.find((t: any) => t.id === tiers[0].id).price).toBe(9000000);
    const v = await db("premium_vehicles").where({ id: vehicle.id }).first();
    expect(Number(v.from_price)).toBe(9000000);
    await db("premium_tiers").where({ id: tiers[0].id }).update({ price: Number(tiers[0].price) });
    await db("premium_vehicles").where({ id: vehicle.id }).update({ from_price: Number(vehicle.from_price) });

    const other = await db("premium_tiers").whereNot({ vehicle_id: vehicle.id }).first();
    const bad = await api().put(`${PB}/vehicles/${vehicle.id}/tiers`).set(auth(p.bizToken)).send({ tiers: [{ id: other.id, price: 1 }] });
    expect(bad.status).toBe(422);
  });

  it("blocking a day makes commuter bookings for that day fail; unblocking restores it", async () => {
    const date = futureDate(50);
    const month = date.slice(0, 7);
    const day = Number(date.slice(8, 10));
    const put = await api().put(`${PB}/vehicles/${vehicle.id}/availability`).set(auth(p.bizToken)).send({ month, blockedDays: [day] });
    expect(put.status).toBe(200);
    expect(put.body.data.blockedDays).toContain(day);
    const get = await api().get(`${PB}/vehicles/${vehicle.id}/availability`).query({ month }).set(auth(p.bizToken));
    expect(get.body.data.blockedDays).toContain(day);

    expect((await book(date)).status).toBe(422);
    const un = await api().delete(`${PB}/vehicles/${vehicle.id}/availability/blocked/${date}`).set(auth(p.bizToken));
    expect(un.status).toBe(200);
    expect(un.body.data.blockedDays).not.toContain(day);
    expect((await book(date)).status).toBe(201);
  });

  it("earnings summary and payouts derive from bookings / settlements", async () => {
    const s = await api().get(`${PB}/earnings/summary`).set(auth(p.bizToken));
    expect(s.status).toBe(200);
    const d = s.body.data;
    for (const k of ["nextPayoutAmount", "monthRentals", "grossRevenue", "commission", "netEarnings", "depositsHeld", "depositsRefunded", "approvedDamage", "monthNet", "monthAdjusted"]) {
      expect(typeof d[k]).toBe("number");
    }
    expect(d.grossRevenue - d.commission).toBe(d.netEarnings);
    expect(d.payoutAccountMasked).toContain("9311");
    expect(d.nextPayoutAmount).toBe(22700000);

    const po = await api().get(`${PB}/payouts`).set(auth(p.bizToken));
    expect(po.status).toBe(200);
    expect(po.body.data.length).toBeGreaterThanOrEqual(2);
    expect(po.body.data.map((x: any) => x.status)).toEqual(expect.arrayContaining(["paid", "scheduled"]));
  });
});

describe("RBAC on partner endpoints", () => {
  const targets: Array<[string, string]> = [
    ["get", `${PB}/bookings`],
    ["get", `${PB}/bookings/requests`],
    ["post", `${PB}/bookings/00000000-0000-4000-8000-000000000000/accept`],
    ["get", `${PB}/earnings/summary`],
    ["get", `${PB}/payouts`],
    ["patch", `${PB}/settings`],
  ];

  it("rejects unauthenticated, commuter, driver and admin tokens", async () => {
    for (const [method, url] of targets) {
      expect((await (api() as any)[method](url)).status).toBe(401);
      for (const t of [p.commuterToken, p.driverToken, p.adminToken]) {
        const res = await (api() as any)[method](url).set(auth(t)).send({});
        expect([401, 403]).toContain(res.status);
      }
    }
  });

  it("a staff team member can read but not accept, decline, inspect or change settings", async () => {
    const [staff] = await db("users").insert({ user_type: "business", first_name: "Staff", last_name: "Member", email: "staff.member@eliteridelagos.ng", status: "active" }).returning("*");
    await db("business_team_members").insert({ business_id: p.business.id, user_id: staff.id, role: "staff", status: "active" });
    const staffToken = tokenFor(staff, { businessId: p.business.id, businessRole: "staff" });

    expect((await api().get(`${PB}/bookings`).set(auth(staffToken))).status).toBe(200);
    const { booking } = await insertBooking("requested", 60);
    await db("premium_bookings").where({ id: booking.id }).update({ respond_by: db.raw("now() + interval '1 hour'") });
    expect((await api().post(`${PB}/bookings/${booking.id}/accept`).set(auth(staffToken))).status).toBe(403);
    expect((await api().post(`${PB}/bookings/${booking.id}/decline`).set(auth(staffToken)).send({ reason: "nope nope" })).status).toBe(403);
    expect((await api().patch(`${PB}/settings`).set(auth(staffToken)).send({ bookingMode: "request" })).status).toBe(403);
    expect((await api().put(`${PB}/payout-account`).set(auth(staffToken)).send({ bankName: "GTBank", accountNumber: "0123456789", accountName: "X Y" })).status).toBe(403);
  });

  it("a partner cannot see another business's booking", async () => {
    const [otherOwner] = await db("users").insert({ user_type: "business", first_name: "Other", last_name: "Owner", email: "other.owner@example.com", status: "active" }).returning("*");
    const [otherBiz] = await db("businesses").insert({ owner_user_id: otherOwner.id, name: "Other Rides", status: "verified" }).returning("*");
    await db("business_team_members").insert({ business_id: otherBiz.id, user_id: otherOwner.id, role: "owner", status: "active" });
    const otherToken = tokenFor(otherOwner, { businessId: otherBiz.id, businessRole: "owner" });
    const { booking } = await insertBooking("confirmed", 70);
    expect((await api().get(`${PB}/bookings/${booking.id}`).set(auth(otherToken))).status).toBe(404);
    expect((await api().post(`${PB}/bookings/${booking.id}/decline`).set(auth(otherToken)).send({ reason: "not mine" })).status).toBe(404);
  });
});
