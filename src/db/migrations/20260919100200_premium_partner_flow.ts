import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("businesses", (t) => {
    // "instant" = bookings auto-confirm (legacy behaviour, default). "request" = partner must accept/decline.
    t.string("booking_mode", 10).notNullable().defaultTo("instant");
    t.string("payout_bank_name", 100);
    t.string("payout_bank_code", 20);
    t.string("payout_account_number", 20);
    t.string("payout_account_name", 150);
  });
  await knex.raw(`ALTER TABLE businesses ADD CONSTRAINT businesses_booking_mode_chk CHECK (booking_mode IN ('instant','request'))`);

  await knex.schema.alterTable("premium_vehicles", (t) => {
    t.integer("year");
    t.string("plate", 20);
  });

  await knex.schema.alterTable("premium_bookings", (t) => {
    t.timestamp("requested_at", { useTz: true });
    t.timestamp("respond_by", { useTz: true }); // partner must answer before this (status = requested)
    t.timestamp("accepted_at", { useTz: true });
    t.timestamp("declined_at", { useTz: true });
    t.string("decline_reason", 255);
    t.timestamp("returned_at", { useTz: true });
    t.decimal("commission_pct", 5, 2); // snapshot of the platform commission at booking time
    t.string("occasion", 150);
  });

  await knex.schema.createTable("booking_events", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("booking_id").notNullable().references("id").inTable("premium_bookings").onDelete("CASCADE");
    // requested | confirmed | accepted | declined | expired | started | returned | inspected | completed | cancelled
    t.string("kind", 30).notNullable();
    t.string("title", 150).notNullable();
    t.string("subtitle", 255);
    t.uuid("actor_id").references("id").inTable("users").onDelete("SET NULL");
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["booking_id", "created_at"]);
  });

  await knex.schema.createTable("booking_inspections", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("booking_id").notNullable().unique().references("id").inTable("premium_bookings").onDelete("CASCADE");
    t.uuid("submitted_by").references("id").inTable("users").onDelete("SET NULL");
    t.jsonb("items").notNullable().defaultTo("{}"); // { "Exterior": "ok", "Interior": "issue", ... }
    t.jsonb("photos").notNullable().defaultTo("[]"); // array of URL strings
    t.string("note", 1000);
    t.integer("issue_count").notNullable().defaultTo(0);
    t.bigInteger("claim_amount").notNullable().defaultTo(0); // kobo, capped at the held deposit
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("premium_vehicle_blocked_days", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("vehicle_id").notNullable().references("id").inTable("premium_vehicles").onDelete("CASCADE");
    t.date("day").notNullable();
    t.string("reason", 150);
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(["vehicle_id", "day"]);
  });

  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS protection_deposits_one_per_booking ON protection_deposits (booking_id)`);

  // Existing bookings: give the timeline a "confirmed" event, and make sure each has a deposit row.
  await knex.raw(`
    INSERT INTO booking_events (booking_id, kind, title, subtitle, created_at)
    SELECT id, 'confirmed', 'Booking confirmed', 'Confirmed automatically', created_at FROM premium_bookings
  `);
  await knex.raw(`
    INSERT INTO protection_deposits (booking_id, held_amount)
    SELECT id, deposit FROM premium_bookings WHERE deposit > 0
    ON CONFLICT (booking_id) DO NOTHING
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP INDEX IF EXISTS protection_deposits_one_per_booking");
  await knex.schema.dropTableIfExists("premium_vehicle_blocked_days");
  await knex.schema.dropTableIfExists("booking_inspections");
  await knex.schema.dropTableIfExists("booking_events");
  await knex.schema.alterTable("premium_bookings", (t) => {
    for (const c of ["requested_at", "respond_by", "accepted_at", "declined_at", "decline_reason", "returned_at", "commission_pct", "occasion"]) t.dropColumn(c);
  });
  await knex.schema.alterTable("premium_vehicles", (t) => {
    t.dropColumn("year");
    t.dropColumn("plate");
  });
  await knex.raw("ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_booking_mode_chk");
  await knex.schema.alterTable("businesses", (t) => {
    for (const c of ["booking_mode", "payout_bank_name", "payout_bank_code", "payout_account_number", "payout_account_name"]) t.dropColumn(c);
  });
}
