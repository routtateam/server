import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("businesses", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("owner_user_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    t.string("name", 150).notNullable();
    t.string("location", 200);
    t.text("about");
    t.decimal("rating", 3, 2).notNullable().defaultTo(5.0);
    t.enu("status", ["pending", "verified", "action_required", "suspended"], {
      useNative: true,
      enumName: "business_status_enum",
    })
      .notNullable()
      .defaultTo("pending");
    t.timestamp("verified_since", { useTz: true });
    t.timestamps(true, true);

    t.index(["owner_user_id"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("business_team_members", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    t.uuid("user_id").references("id").inTable("users").onDelete("CASCADE");
    t.string("invited_email", 255);
    t.enu("role", ["owner", "manager", "staff"], { useNative: true, enumName: "business_team_role_enum" })
      .notNullable()
      .defaultTo("staff");
    t.enu("status", ["invited", "active", "suspended"], { useNative: true, enumName: "business_team_status_enum" })
      .notNullable()
      .defaultTo("invited");
    t.timestamps(true, true);

    t.index(["business_id"]);
    t.unique(["business_id", "invited_email"]);
  });

  await knex.schema.createTable("premium_vehicles", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    t.string("name", 150).notNullable();
    t.string("type", 100); // Sedan, SUV, Bus...
    t.string("brand", 100);
    t.string("location", 200);
    t.integer("seats");
    t.bigInteger("from_price").notNullable(); // minor units
    t.enu("availability", ["available", "limited", "booked"], {
      useNative: true,
      enumName: "premium_vehicle_availability_enum",
    })
      .notNullable()
      .defaultTo("available");
    t.enu("status", ["live", "under_review", "rejected", "suspended"], {
      useNative: true,
      enumName: "premium_vehicle_status_enum",
    })
      .notNullable()
      .defaultTo("under_review");
    t.jsonb("specs").notNullable().defaultTo("[]");
    t.decimal("rating", 3, 2).notNullable().defaultTo(5.0);
    t.integer("reviews").notNullable().defaultTo(0);
    t.timestamps(true, true);

    t.index(["business_id"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("premium_tiers", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("vehicle_id").notNullable().references("id").inTable("premium_vehicles").onDelete("CASCADE");
    t.string("label", 100).notNullable();
    t.string("sub", 150);
    t.bigInteger("price").notNullable(); // minor units

    t.index(["vehicle_id"]);
  });

  await knex.schema.createTable("premium_bookings", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("vehicle_id").notNullable().references("id").inTable("premium_vehicles").onDelete("RESTRICT");
    t.uuid("tier_id").references("id").inTable("premium_tiers").onDelete("SET NULL");
    t.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("RESTRICT");
    t.uuid("commuter_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    t.date("booking_date").notNullable();
    t.string("start_time", 10).notNullable();
    t.integer("duration_hours").notNullable();
    t.enu("status", ["confirmed", "active", "completed", "disputed", "cancelled"], {
      useNative: true,
      enumName: "premium_booking_status_enum",
    })
      .notNullable()
      .defaultTo("confirmed");
    t.bigInteger("deposit").notNullable().defaultTo(0);
    t.bigInteger("service_fee").notNullable().defaultTo(0);
    t.bigInteger("total").notNullable();
    t.string("pilot_name", 150);
    t.decimal("pilot_rating", 3, 2);
    t.timestamps(true, true);

    t.index(["business_id"]);
    t.index(["commuter_id"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("protection_deposits", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("booking_id").notNullable().references("id").inTable("premium_bookings").onDelete("CASCADE");
    t.bigInteger("held_amount").notNullable();
    t.bigInteger("claim_amount").notNullable().defaultTo(0);
    t.bigInteger("refund_amount").notNullable().defaultTo(0);
    t.string("inspection_note", 500);
    t.enu("status", ["held", "refunded", "partially_refunded", "claimed", "disputed"], {
      useNative: true,
      enumName: "deposit_status_enum",
    })
      .notNullable()
      .defaultTo("held");
    t.timestamps(true, true);

    t.index(["booking_id"]);
  });

  await knex.schema.createTable("settlements", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    t.date("period_start").notNullable();
    t.date("period_end").notNullable();
    t.bigInteger("gross").notNullable();
    t.bigInteger("commission").notNullable();
    t.bigInteger("adjustment").notNullable().defaultTo(0);
    t.bigInteger("payable").notNullable();
    t.enu("status", ["scheduled", "on_hold", "paid"], { useNative: true, enumName: "settlement_status_enum" })
      .notNullable()
      .defaultTo("scheduled");
    t.timestamp("paid_at", { useTz: true });
    t.timestamps(true, true);

    t.index(["business_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("settlements");
  await knex.schema.dropTableIfExists("protection_deposits");
  await knex.schema.dropTableIfExists("premium_bookings");
  await knex.schema.dropTableIfExists("premium_tiers");
  await knex.schema.dropTableIfExists("premium_vehicles");
  await knex.schema.dropTableIfExists("business_team_members");
  await knex.schema.dropTableIfExists("businesses");

  for (const t of [
    "settlement_status_enum",
    "deposit_status_enum",
    "premium_booking_status_enum",
    "premium_vehicle_status_enum",
    "premium_vehicle_availability_enum",
    "business_team_status_enum",
    "business_team_role_enum",
    "business_status_enum",
  ]) {
    await knex.raw(`DROP TYPE IF EXISTS ${t}`);
  }
}
