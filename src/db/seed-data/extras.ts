// Realistic demo data layered on top of the base persona accounts created in seeds/03_demo_accounts.ts.
// Lives outside src/db/seeds so knex does not treat it as a seed file.
import type { Knex } from "knex";

export interface SeedContext {
  adminId: string;
  commuterId: string;
  driverId: string;
  vehicleId: string;
  bizOwnerId: string;
  businessId: string;
  premiumVehicleId: string;
}

const ago = (knex: Knex, interval: string) => knex.raw(`now() - interval '${interval}'`);
const ahead = (knex: Knex, interval: string) => knex.raw(`now() + interval '${interval}'`);
const dateAhead = (knex: Knex, days: number) => knex.raw(`current_date + (${days})`);

/** Wipes every table this file (and later features) writes to, children first, so the seed is re-runnable. */
export async function clearDemoData(knex: Knex): Promise<void> {
  for (const t of [
    "booking_events",
    "booking_inspections",
    "protection_deposits",
    "premium_bookings",
    "premium_vehicle_blocked_days",
    "settlements",
    "ticket_messages",
    "support_tickets",
    "dispute_messages",
    "disputes",
    "scheduled_rides",
    "trip_declines",
    "driver_online_sessions",
    "payouts",
    "transactions",
    "notifications",
    "emergency_contacts",
    "saved_places",
    "trips",
    "payment_methods",
    "otps",
  ]) {
    await knex(t).del();
  }
}

export async function seedExtras(knex: Knex, c: SeedContext): Promise<void> {
  // ------------------------------------------------------------------ commuter
  const [card] = await knex("payment_methods")
    .insert({ user_id: c.commuterId, kind: "card", brand: "visa", last4: "4821", bank: "GTBank", expiry: "08/28", is_default: true })
    .returning(["id"]);
  await knex("saved_places").insert([
    { user_id: c.commuterId, label: "Home", subtitle: "12 Adeola Odeku St, Victoria Island", lat: 6.4281, lng: 3.4219, kind: "home" },
    { user_id: c.commuterId, label: "Work", subtitle: "Ikeja City Mall, Obafemi Awolowo Way", lat: 6.6018, lng: 3.3515, kind: "work" },
    { user_id: c.commuterId, label: "Ikoyi Club 1938", subtitle: "Kingsway Rd, Ikoyi", lat: 6.4531, lng: 3.4363, kind: "recent" },
  ]);
  await knex("emergency_contacts").insert({ user_id: c.commuterId, name: "Ngozi Nwosu", relation: "Sister", phone: "+2348030001111", is_primary: true });

  // ------------------------------------------------------------------ driver
  await knex("driver_profiles").where({ user_id: c.driverId }).update({
    online: true, // matching (GET /trips/:id polling) needs at least one online driver with a vehicle
    offers_accepted: 10,
    offers_declined: 1, // 10 / 11 -> 91% acceptance
    payout_bank_name: "GTBank",
    payout_bank_code: "058",
    payout_account_number: "0123459310",
    payout_account_name: "Chinedu Okafor",
    settings: JSON.stringify({ autoAcceptNearby: false, longTripsOnly: false, voiceNavigation: true, readRequestsAloud: true, shareTripsWithFamily: true, navigationApp: "Google Maps" }),
  });
  await knex("emergency_contacts").insert({ user_id: c.driverId, name: "Amaka Okafor", relation: "Wife", phone: "+2348030002222", is_primary: true });
  // Online right now (open session) + a full session yesterday for the "yesterday / online hours" figures.
  await knex("driver_online_sessions").insert([
    { driver_id: c.driverId, started_at: ago(knex, "3 hours"), ended_at: null },
    { driver_id: c.driverId, started_at: ago(knex, "1 day 8 hours"), ended_at: ago(knex, "1 day 1 hour") },
  ]);

  const driverWallet = await knex("wallets").where({ user_id: c.driverId }).first();
  const trips: Array<{ interval: string; fare: number; dest: string; lat: number; lng: number; status: "completed" | "cancelled"; km: number; rating?: number }> = [
    { interval: "2 hours", fare: 245000, dest: "Ikeja City Mall", lat: 6.6018, lng: 3.3515, status: "completed", km: 18.4, rating: 5 },
    { interval: "5 hours", fare: 115000, dest: "Ikoyi Club 1938", lat: 6.4531, lng: 3.4363, status: "completed", km: 6.1, rating: 5 },
    { interval: "1 day 3 hours", fare: 198000, dest: "Lekki Phase 1 Gate", lat: 6.4415, lng: 3.4731, status: "completed", km: 14.2, rating: 4 },
    { interval: "3 days", fare: 310000, dest: "Murtala Muhammed Airport", lat: 6.5774, lng: 3.3212, status: "completed", km: 24.9, rating: 5 },
    { interval: "6 days", fare: 60000, dest: "Balogun Market", lat: 6.4531, lng: 3.3958, status: "cancelled", km: 0 },
  ];
  let firstCompletedTripId: string | undefined;
  for (const t of trips) {
    const completed = t.status === "completed";
    const commission = Math.round(t.fare * 0.15);
    const [row] = await knex("trips")
      .insert({
        commuter_id: c.commuterId,
        driver_id: c.driverId,
        vehicle_id: c.vehicleId,
        category: "car",
        pickup_label: "12 Adeola Odeku St, VI",
        pickup_lat: 6.4281,
        pickup_lng: 3.4219,
        destination_label: t.dest,
        destination_lat: t.lat,
        destination_lng: t.lng,
        distance_km: t.km,
        eta_minutes: 4,
        fare: t.fare,
        payment_method_id: card.id,
        status: t.status,
        pin: String(1000 + Math.floor(Math.random() * 9000)),
        rating_by_commuter: t.rating ?? null,
        accepted_at: ago(knex, `${t.interval} 40 minutes`),
        started_at: completed ? ago(knex, `${t.interval} 25 minutes`) : null,
        completed_at: completed ? ago(knex, t.interval) : null,
        cancelled_at: completed ? null : ago(knex, t.interval),
        cancelled_by: completed ? null : c.commuterId,
        cancel_reason: completed ? null : "Changed my plans",
        cancel_fee: completed ? 0 : 30000,
        settled_at: completed ? ago(knex, t.interval) : null,
        driver_earning: completed ? t.fare - commission : null,
        platform_fee: completed ? commission : null,
        created_at: ago(knex, `${t.interval} 45 minutes`),
      })
      .returning(["id"]);
    if (completed) {
      firstCompletedTripId ??= row.id;
      await knex("transactions").insert({
        wallet_id: driverWallet.id,
        user_id: c.driverId,
        type: "fare_payment",
        amount: t.fare - commission,
        status: "successful",
        provider: "internal",
        trip_id: row.id,
        metadata: JSON.stringify({ fare: t.fare, commission, feePct: 15 }),
        created_at: ago(knex, t.interval),
      });
    }
  }

  // Commuter <-> support: a dispute on the first trip and a general ticket, both with threads.
  const [dispute] = await knex("disputes")
    .insert({
      trip_id: firstCompletedTripId,
      raised_by: c.commuterId,
      title: "Overcharged by N500",
      kind: "fare",
      amount: 50000,
      description: "The app quoted N2,450 but my card was charged N2,950.",
      sla_due_at: ahead(knex, "20 hours"),
      first_response_at: ago(knex, "1 hour"),
      created_at: ago(knex, "4 hours"),
    })
    .returning(["id"]);
  await knex("dispute_messages").insert([
    { dispute_id: dispute.id, author_id: c.commuterId, author_role: "you", body: "The app quoted N2,450 but my card was charged N2,950.", created_at: ago(knex, "4 hours") },
    { dispute_id: dispute.id, author_id: c.adminId, author_role: "support", body: "Thanks Adaeze, we can see both amounts on this trip. Our payments team is confirming which one settled.", created_at: ago(knex, "1 hour") },
  ]);
  const [ticket] = await knex("support_tickets")
    .insert({
      requester_id: c.driverId,
      subject: "Payout has not arrived",
      body: "I cashed out on Monday and the money has not reached my GTBank account.",
      priority: "high",
      status: "open",
      sla_due_at: ahead(knex, "2 hours"),
      created_at: ago(knex, "2 hours"),
    })
    .returning(["id"]);
  await knex("ticket_messages").insert({ ticket_id: ticket.id, author_id: c.driverId, author_role: "you", body: "I cashed out on Monday and the money has not reached my GTBank account.", created_at: ago(knex, "2 hours") });

  await knex("scheduled_rides").insert({
    commuter_id: c.commuterId,
    category: "car",
    pickup_label: "12 Adeola Odeku St, VI",
    pickup_lat: 6.4281,
    pickup_lng: 3.4219,
    destination_label: "Murtala Muhammed Airport",
    destination_lat: 6.5774,
    destination_lng: 3.3212,
    scheduled_for: ahead(knex, "2 days"),
    fare_estimate: 310000,
    payment_method_id: card.id,
    note: "Flight at 09:40",
  });

  await knex("notifications").insert([
    { user_id: c.commuterId, title: "Welcome to Routta", body: "Your account is ready. Take your first ride!", kind: "system", read: true },
    { user_id: c.commuterId, title: "Update on your dispute", body: "Our payments team is confirming which charge settled.", kind: "chat", read: false },
    { user_id: c.driverId, title: "Trip earnings added", body: "N2,082 was added to your wallet for your last trip.", kind: "money", read: false },
    { user_id: c.driverId, title: "Insurance expiring", body: "Your vehicle insurance expires in 12 days.", kind: "doc", read: false },
  ]);

  // ------------------------------------------------------------------ pending driver applicant (admin verifications queue)
  const [applicant] = await knex("users")
    .insert({ user_type: "driver", first_name: "Tunde", last_name: "Bakare", phone: "+2348039990001", email: "tunde.bakare@example.com", status: "pending", rating: 5 })
    .returning(["id"]);
  await knex("wallets").insert({ user_id: applicant.id, balance: 0 });
  await knex("driver_profiles").insert({ user_id: applicant.id, city: "Lagos", license_number: "LIC-2026-55120", verified: false, member_since_year: new Date().getFullYear() });
  const [applicantVehicle] = await knex("vehicles")
    .insert({ driver_id: applicant.id, category: "bike", make: "Bajaj", model: "Boxer", year: 2021, colour: "Black", plate: "LSR 302 AB", seats: 1 })
    .returning(["id"]);
  await knex("documents").insert([
    { owner_type: "driver", owner_id: applicant.id, doc_key: "licence", doc_name: "Driver's licence", status: "pending", meta: "Under review · usually within 24 hours" },
    { owner_type: "vehicle", owner_id: applicantVehicle.id, doc_key: "registration", doc_name: "Vehicle registration", status: "pending", meta: "Under review · usually within 24 hours" },
  ]);

  // ------------------------------------------------------------------ business partner (Elite Rides Lagos)
  await knex("businesses").where({ id: c.businessId }).update({
    booking_mode: "instant", // change via PATCH /premium-business/settings { bookingMode: "request" }
    payout_bank_name: "GTBank",
    payout_bank_code: "058",
    payout_account_number: "0123459311",
    payout_account_name: "Elite Rides Lagos Ltd",
  });
  await knex("premium_vehicles").where({ id: c.premiumVehicleId }).update({ year: 2022, plate: "LND 218 KJA" });
  const [v2] = await knex("premium_vehicles")
    .insert({
      business_id: c.businessId,
      name: "Mercedes-Benz E-Class",
      type: "Sedan",
      brand: "Mercedes-Benz",
      location: "Victoria Island, Lagos",
      seats: 4,
      from_price: 6000000,
      availability: "available",
      status: "live",
      year: 2021,
      plate: "EKY 771 LG",
      specs: JSON.stringify([{ key: "Transmission", value: "Automatic" }, { key: "Chauffeur", value: "Included" }]),
      rating: 4.7,
      reviews: 18,
    })
    .returning(["id"]);
  await knex("premium_vehicles").insert({
    business_id: c.businessId,
    name: "Toyota Hiace Executive Bus",
    type: "Bus",
    brand: "Toyota",
    location: "Ikeja, Lagos",
    seats: 14,
    from_price: 9000000,
    availability: "available",
    status: "under_review",
    year: 2020,
    plate: "KJA 908 XY",
    specs: JSON.stringify([]),
  });
  const tiers1 = await knex("premium_tiers").where({ vehicle_id: c.premiumVehicleId }).orderBy("price", "asc");
  const tiers2 = await knex("premium_tiers")
    .insert([
      { vehicle_id: v2.id, label: "4 hours", sub: "Half-day hire", price: 6000000 },
      { vehicle_id: v2.id, label: "8 hours", sub: "Full-day hire", price: 11000000 },
      { vehicle_id: v2.id, label: "24 hours", sub: "Full day + overnight", price: 19000000 },
    ])
    .returning("*");
  await knex("premium_vehicle_blocked_days").insert([
    { vehicle_id: c.premiumVehicleId, day: dateAhead(knex, 6), reason: "Servicing" },
    { vehicle_id: c.premiumVehicleId, day: dateAhead(knex, 7), reason: "Servicing" },
  ]);

  const extraCommuters = await knex("users")
    .insert([
      { user_type: "commuter", first_name: "Tobi", last_name: "Adeyemi", email: "tobi.adeyemi@example.com", phone: "+2348030000011", phone_verified: true, rating: 4.9, status: "active" },
      { user_type: "commuter", first_name: "Ifeoma", last_name: "Eze", email: "ifeoma.eze@example.com", phone: "+2348030000012", phone_verified: true, rating: 4.6, status: "active" },
    ])
    .returning(["id"]);
  const [tobi, ifeoma] = extraCommuters;
  await knex("wallets").insert(extraCommuters.map((u: any) => ({ user_id: u.id, balance: 0 })));

  const commissionPct = 20;
  async function booking(o: {
    commuter: string;
    vehicle: string;
    tier: any;
    dayOffset: number;
    start: string;
    status: string;
    respondBy?: any;
    occasion?: string;
    depositStatus?: string;
    claim?: number;
    events: Array<[string, string, string | undefined, string]>; // kind, title, subtitle, interval-ago
    inspection?: { items: Record<string, string>; note: string };
  }) {
    const price = Number(o.tier.price);
    const deposit = Math.round((price * 0.4) / 100) * 100;
    const fee = Math.round((price * 0.04) / 100) * 100;
    const hours = Number(String(o.tier.label).split(" ")[0]) || 6;
    const [b] = await knex("premium_bookings")
      .insert({
        vehicle_id: o.vehicle,
        tier_id: o.tier.id,
        business_id: c.businessId,
        commuter_id: o.commuter,
        booking_date: dateAhead(knex, o.dayOffset),
        start_time: o.start,
        duration_hours: hours,
        status: o.status,
        deposit,
        service_fee: fee,
        total: price + deposit + fee,
        commission_pct: commissionPct,
        occasion: o.occasion ?? null,
        requested_at: o.status === "requested" ? ago(knex, "1 hour") : null,
        respond_by: o.respondBy ?? null,
        accepted_at: ["confirmed", "active", "completed"].includes(o.status) ? ago(knex, "2 days") : null,
        returned_at: o.status === "completed" ? ago(knex, `${Math.abs(o.dayOffset)} days`) : null,
        pilot_name: o.status === "requested" ? null : "Segun Adebayo",
        pilot_rating: o.status === "requested" ? null : 4.9,
      })
      .returning("*");
    await knex("protection_deposits").insert({
      booking_id: b.id,
      held_amount: deposit,
      claim_amount: o.claim ?? 0,
      refund_amount: o.depositStatus === "refunded" ? deposit : o.depositStatus === "claimed" ? deposit - (o.claim ?? 0) : 0,
      status: o.depositStatus ?? "held",
      inspection_note: o.inspection?.note ?? null,
    });
    for (const [kind, title, subtitle, interval] of o.events) {
      await knex("booking_events").insert({ booking_id: b.id, kind, title, subtitle: subtitle ?? null, created_at: ago(knex, interval) });
    }
    if (o.inspection) {
      await knex("booking_inspections").insert({
        booking_id: b.id,
        submitted_by: c.bizOwnerId,
        items: JSON.stringify(o.inspection.items),
        photos: JSON.stringify([]),
        note: o.inspection.note,
        issue_count: Object.values(o.inspection.items).filter((v) => v === "issue").length,
        claim_amount: o.claim ?? 0,
      });
    }
    return b;
  }

  const t8 = tiers1.find((t: any) => t.label === "8 hours") ?? tiers1[0];
  const t4 = tiers1.find((t: any) => t.label === "4 hours") ?? tiers1[0];
  const e8 = tiers2.find((t: any) => t.label === "8 hours");

  // 1) Pending request awaiting partner acceptance (shows in the partner "Requests" tab)
  await booking({
    commuter: tobi.id, vehicle: v2.id, tier: e8, dayOffset: 3, start: "09:00", status: "requested", respondBy: ahead(knex, "6 hours"),
    occasion: "Wedding", events: [["requested", "Request received", "Waiting for the partner to accept", "1 hour"]],
  });
  // 2) Confirmed, upcoming
  await booking({
    commuter: ifeoma.id, vehicle: c.premiumVehicleId, tier: t4, dayOffset: 2, start: "14:00", status: "confirmed", occasion: "Airport transfer",
    events: [["confirmed", "Booking confirmed", "Confirmed automatically", "2 days"]],
  });
  // 3) Active today (also the main commuter's active premium booking)
  await booking({
    commuter: c.commuterId, vehicle: c.premiumVehicleId, tier: t8, dayOffset: 0, start: "08:00", status: "active", occasion: "Executive hire",
    events: [["confirmed", "Booking confirmed", "Confirmed automatically", "3 days"], ["started", "Vehicle handed over", undefined, "4 hours"]],
  });
  // 4) Completed, clean return, deposit refunded in full
  await booking({
    commuter: tobi.id, vehicle: c.premiumVehicleId, tier: t8, dayOffset: -5, start: "10:00", status: "completed", depositStatus: "refunded", occasion: "Corporate event",
    events: [["confirmed", "Booking confirmed", undefined, "8 days"], ["started", "Vehicle handed over", undefined, "5 days"], ["returned", "Vehicle returned", undefined, "5 days"], ["inspected", "Return inspection submitted", "No issues found", "5 days"], ["completed", "Rental completed", undefined, "5 days"]],
    inspection: { items: { Exterior: "ok", Interior: "ok", Fuel: "ok" }, note: "All good." },
  });
  // 5) Completed with an approved damage claim (N15,000 = 1,500,000 kobo)
  await booking({
    commuter: ifeoma.id, vehicle: v2.id, tier: e8, dayOffset: -9, start: "12:00", status: "completed", depositStatus: "claimed", claim: 1500000, occasion: "Birthday",
    events: [["confirmed", "Booking confirmed", undefined, "12 days"], ["started", "Vehicle handed over", undefined, "9 days"], ["returned", "Vehicle returned", undefined, "9 days"], ["inspected", "Return inspection submitted", "1 issue · claim 15000", "9 days"], ["completed", "Rental completed", undefined, "9 days"]],
    inspection: { items: { Exterior: "ok", Interior: "issue", Fuel: "ok" }, note: "Stain on rear seat." },
  });

  await knex("settlements").insert([
    { business_id: c.businessId, period_start: knex.raw("date_trunc('month', current_date) - interval '1 month'"), period_end: knex.raw("date_trunc('month', current_date) - interval '1 day'"), gross: 12400000, commission: 2480000, adjustment: 0, payable: 9920000, status: "paid", paid_at: ago(knex, "12 days") },
    { business_id: c.businessId, period_start: knex.raw("date_trunc('month', current_date)"), period_end: knex.raw("current_date + 3"), gross: 26500000, commission: 5300000, adjustment: 1500000, payable: 22700000, status: "scheduled" },
  ]);

  await knex("notifications").insert([
    { user_id: c.bizOwnerId, title: "New booking request", body: "Tobi requested the Mercedes-Benz E-Class. Respond within 12h.", kind: "system", read: false },
  ]);
}
