import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("promotions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("code", 40).notNullable().unique();
    t.string("description", 255);
    t.enu("discount_type", ["fixed", "percent"], { useNative: true, enumName: "promo_discount_type_enum" }).notNullable();
    t.decimal("discount_value", 10, 2).notNullable();
    t.enu("category_scope", ["bike", "car", "bus", "van", "all"], {
      useNative: true,
      enumName: "promo_scope_enum",
    })
      .notNullable()
      .defaultTo("all");
    t.timestamp("starts_at", { useTz: true });
    t.timestamp("ends_at", { useTz: true });
    t.integer("usage_limit");
    t.integer("used_count").notNullable().defaultTo(0);
    t.enu("status", ["active", "scheduled", "expired", "disabled"], {
      useNative: true,
      enumName: "promo_status_enum",
    })
      .notNullable()
      .defaultTo("active");
    t.timestamps(true, true);
  });

  await knex.schema.createTable("saved_places", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("label", 150).notNullable();
    t.string("subtitle", 255);
    t.decimal("lat", 10, 7).notNullable();
    t.decimal("lng", 10, 7).notNullable();
    t.enu("kind", ["home", "work", "recent", "search", "saved"], { useNative: true, enumName: "place_kind_enum" }).notNullable();
    t.timestamps(true, true);

    t.index(["user_id"]);
  });

  await knex.schema.createTable("trips", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("commuter_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    t.uuid("driver_id").references("id").inTable("users").onDelete("SET NULL");
    t.uuid("vehicle_id").references("id").inTable("vehicles").onDelete("SET NULL");
    t.enu("category", ["bike", "car", "bus", "van"], { useNative: true, enumName: "trip_category_enum" }).notNullable();

    t.string("pickup_label", 150).notNullable();
    t.decimal("pickup_lat", 10, 7).notNullable();
    t.decimal("pickup_lng", 10, 7).notNullable();
    t.string("destination_label", 150).notNullable();
    t.decimal("destination_lat", 10, 7).notNullable();
    t.decimal("destination_lng", 10, 7).notNullable();

    t.decimal("distance_km", 8, 2);
    t.integer("eta_minutes");
    t.bigInteger("fare").notNullable(); // minor units
    t.bigInteger("promo_discount").notNullable().defaultTo(0);
    t.string("promo_code", 40);
    t.uuid("payment_method_id").references("id").inTable("payment_methods").onDelete("SET NULL");

    t.enu(
      "status",
      ["matching", "no_match", "accepted", "enroute", "arrived", "in_progress", "active", "completed", "cancelled"],
      { useNative: true, enumName: "trip_status_enum" }
    )
      .notNullable()
      .defaultTo("matching");

    t.string("pin", 6).notNullable();
    t.decimal("rating_by_commuter", 2, 1);
    t.decimal("rating_by_driver", 2, 1);
    t.string("cancel_reason", 255);
    t.uuid("cancelled_by").references("id").inTable("users");

    t.timestamp("accepted_at", { useTz: true });
    t.timestamp("started_at", { useTz: true });
    t.timestamp("completed_at", { useTz: true });
    t.timestamp("cancelled_at", { useTz: true });
    t.timestamps(true, true);

    t.index(["commuter_id"]);
    t.index(["driver_id"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("disputes", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("trip_id").references("id").inTable("trips").onDelete("SET NULL");
    t.uuid("raised_by").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("title", 200).notNullable();
    t.enu("kind", ["fare", "route", "safety", "lost", "other"], { useNative: true, enumName: "dispute_kind_enum" })
      .notNullable()
      .defaultTo("other");
    t.enu("status", ["under_review", "resolved"], { useNative: true, enumName: "dispute_status_enum" })
      .notNullable()
      .defaultTo("under_review");
    t.bigInteger("amount").notNullable().defaultTo(0);
    t.string("resolution_note", 500);
    t.timestamps(true, true);

    t.index(["trip_id"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("dispute_messages", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("dispute_id").notNullable().references("id").inTable("disputes").onDelete("CASCADE");
    t.uuid("author_id").references("id").inTable("users");
    t.enu("author_role", ["you", "support"], { useNative: true, enumName: "dispute_author_role_enum" }).notNullable();
    t.text("body").notNullable();
    t.timestamps(true, true);

    t.index(["dispute_id"]);
  });

  await knex.schema.createTable("support_tickets", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("requester_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("subject", 200).notNullable();
    t.enu("channel", ["in_app", "whatsapp", "email"], { useNative: true, enumName: "support_channel_enum" })
      .notNullable()
      .defaultTo("in_app");
    t.enu("priority", ["low", "medium", "high"], { useNative: true, enumName: "support_priority_enum" })
      .notNullable()
      .defaultTo("medium");
    t.enu("status", ["open", "pending", "resolved", "closed"], { useNative: true, enumName: "support_status_enum" })
      .notNullable()
      .defaultTo("open");
    t.uuid("assignee_id").references("id").inTable("users");
    t.uuid("related_trip_id").references("id").inTable("trips");
    t.text("body");
    t.timestamps(true, true);

    t.index(["requester_id"]);
    t.index(["status"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("support_tickets");
  await knex.schema.dropTableIfExists("dispute_messages");
  await knex.schema.dropTableIfExists("disputes");
  await knex.schema.dropTableIfExists("trips");
  await knex.schema.dropTableIfExists("saved_places");
  await knex.schema.dropTableIfExists("promotions");

  for (const t of [
    "support_status_enum",
    "support_priority_enum",
    "support_channel_enum",
    "dispute_author_role_enum",
    "dispute_status_enum",
    "dispute_kind_enum",
    "trip_status_enum",
    "trip_category_enum",
    "place_kind_enum",
    "promo_status_enum",
    "promo_scope_enum",
    "promo_discount_type_enum",
  ]) {
    await knex.raw(`DROP TYPE IF EXISTS ${t}`);
  }
}
