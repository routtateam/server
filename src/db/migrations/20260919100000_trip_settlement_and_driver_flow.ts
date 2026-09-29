import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  // ---- trips: settlement idempotency, PIN attempt limiting, cancellation fee, early end ----
  await knex.schema.alterTable("trips", (t) => {
    t.timestamp("settled_at", { useTz: true }); // set exactly once when driver earnings are credited
    t.bigInteger("driver_earning"); // net credited to the driver (kobo)
    t.bigInteger("platform_fee"); // Routta commission (kobo)
    t.integer("pin_attempts").notNullable().defaultTo(0);
    t.bigInteger("cancel_fee").notNullable().defaultTo(0); // kobo, charged to commuter on late cancellation
    t.boolean("ended_early").notNullable().defaultTo(false);
    t.string("end_reason", 255);
    t.index(["status", "settled_at"]);
  });

  // Backfill: trips that already have a fare_payment credit are already settled.
  await knex.raw(`
    UPDATE trips t SET settled_at = COALESCE(t.completed_at, now())
    WHERE t.status = 'completed' AND t.settled_at IS NULL
      AND EXISTS (SELECT 1 FROM transactions x WHERE x.trip_id = t.id AND x.type = 'fare_payment')
  `);
  // Second line of defence against double-crediting a trip (tips use type 'adjustment', so are unaffected).
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_fare_payment_per_trip
                  ON transactions (trip_id) WHERE type = 'fare_payment'`);

  // ---- driver profile: payout bank account, acceptance counters, settings ----
  await knex.schema.alterTable("driver_profiles", (t) => {
    t.string("payout_bank_name", 100);
    t.string("payout_bank_code", 20);
    t.string("payout_account_number", 20);
    t.string("payout_account_name", 150);
    t.integer("offers_accepted").notNullable().defaultTo(0);
    t.integer("offers_declined").notNullable().defaultTo(0);
    t.jsonb("settings").notNullable().defaultTo("{}");
  });

  await knex.schema.createTable("trip_declines", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("trip_id").notNullable().references("id").inTable("trips").onDelete("CASCADE");
    t.uuid("driver_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("reason", 255);
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.unique(["trip_id", "driver_id"]);
    t.index(["driver_id"]);
  });

  await knex.schema.createTable("driver_online_sessions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("driver_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.timestamp("started_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("ended_at", { useTz: true });
    t.index(["driver_id", "started_at"]);
  });
  // At most one open session per driver.
  await knex.raw(`CREATE UNIQUE INDEX driver_one_open_session ON driver_online_sessions (driver_id) WHERE ended_at IS NULL`);

  // ---- users: soft delete ----
  await knex.schema.alterTable("users", (t) => {
    t.timestamp("deleted_at", { useTz: true });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("users", (t) => t.dropColumn("deleted_at"));
  await knex.schema.dropTableIfExists("driver_online_sessions");
  await knex.schema.dropTableIfExists("trip_declines");
  await knex.schema.alterTable("driver_profiles", (t) => {
    for (const c of ["payout_bank_name", "payout_bank_code", "payout_account_number", "payout_account_name", "offers_accepted", "offers_declined", "settings"]) t.dropColumn(c);
  });
  await knex.raw("DROP INDEX IF EXISTS transactions_one_fare_payment_per_trip");
  await knex.schema.alterTable("trips", (t) => {
    t.dropIndex(["status", "settled_at"]);
    for (const c of ["settled_at", "driver_earning", "platform_fee", "pin_attempts", "cancel_fee", "ended_early", "end_reason"]) t.dropColumn(c);
  });
}
