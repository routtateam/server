import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, makeTrip, P, personas } from "./helpers";
import { db } from "@/db/knex";

let p: Awaited<ReturnType<typeof personas>>;
beforeAll(async () => {
  p = await personas();
});

const leaks = (body: unknown, pin = "4321") => JSON.stringify(body).includes(pin) || JSON.stringify(body).includes('"pin"');

describe("trip PIN is never exposed to the driver", () => {
  it("commuter sees the PIN, driver does not (GET /trips/:id)", async () => {
    const trip = await makeTrip(p, "accepted");
    const c = await api().get(`${P}/trips/${trip.id}`).set(auth(p.commuterToken));
    expect(c.status).toBe(200);
    expect(c.body.data.pin).toBe("4321");

    const d = await api().get(`${P}/trips/${trip.id}`).set(auth(p.driverToken));
    expect(d.status).toBe(200);
    expect(leaks(d.body)).toBe(false);
  });

  it("driver view carries commuter identity, rating and payment method", async () => {
    const trip = await makeTrip(p, "accepted");
    const d = await api().get(`${P}/trips/${trip.id}`).set(auth(p.driverToken));
    const commuter = d.body.data.commuter;
    expect(commuter.name).toBe("Adaeze N."); // surname reduced to an initial
    expect(commuter.initials).toBe("AN");
    expect(commuter.rating).toBeGreaterThan(0);
    expect(["card", "wallet", "cash"]).toContain(commuter.paymentMethod);
    expect(d.body.data.serviceFeePct).toBe(15);
    expect(d.body.data.commuter.phone).toBeUndefined();
  });

  it("no driver-facing endpoint leaks it: incoming, accept, verify-pin, complete, today, end-early", async () => {
    await db("driver_profiles").where({ user_id: p.driver.id }).update({ online: true });
    const open = await makeTrip(p, "matching");
    const incoming = await api().get(`${P}/trips/incoming`).set(auth(p.driverToken));
    expect(incoming.status).toBe(200);
    expect(incoming.body.data.some((t: any) => t.id === open.id)).toBe(true);
    expect(leaks(incoming.body)).toBe(false);

    const accepted = await api().post(`${P}/trips/${open.id}/accept`).set(auth(p.driverToken));
    expect(accepted.status).toBe(200);
    expect(leaks(accepted.body)).toBe(false);

    const wrong = await api().post(`${P}/trips/${open.id}/verify-pin`).set(auth(p.driverToken)).send({ pin: "0000" });
    expect(wrong.status).toBe(422);
    expect(leaks(wrong.body)).toBe(false);
    const right = await api().post(`${P}/trips/${open.id}/verify-pin`).set(auth(p.driverToken)).send({ pin: "4321" });
    expect(right.status).toBe(200);
    expect(right.body.data.status).toBe("in_progress");
    expect(leaks(right.body)).toBe(false);

    const done = await api().post(`${P}/trips/${open.id}/complete`).set(auth(p.driverToken));
    expect(done.status).toBe(200);
    expect(leaks(done.body)).toBe(false);

    const today = await api().get(`${P}/trips/today`).set(auth(p.driverToken));
    expect(leaks(today.body)).toBe(false);
    const early = await makeTrip(p, "in_progress");
    const ended = await api().post(`${P}/trips/${early.id}/end-early`).set(auth(p.driverToken)).send({ reason: "Rider got out early" });
    expect(ended.status).toBe(200);
    expect(ended.body.data.endedEarly).toBe(true);
    expect(ended.body.data.status).toBe("completed");
    expect(leaks(ended.body)).toBe(false);
  });

  it("admin reassign response never contains the PIN", async () => {
    const trip = await makeTrip(p, "matching");
    const res = await api().post(`${P}/admin/trips/${trip.id}/reassign`).set(auth(p.adminToken)).send({ driverId: p.driver.id });
    expect(res.status).toBe(200);
    expect(leaks(res.body)).toBe(false);
  });

  it("PIN attempts are limited after 5 wrong guesses", async () => {
    const trip = await makeTrip(p, "accepted");
    for (let i = 0; i < 5; i++) {
      const r = await api().post(`${P}/trips/${trip.id}/verify-pin`).set(auth(p.driverToken)).send({ pin: "9999" });
      expect(r.status).toBe(422);
    }
    const locked = await api().post(`${P}/trips/${trip.id}/verify-pin`).set(auth(p.driverToken)).send({ pin: "4321" });
    expect(locked.status).toBe(429);
  });
});
