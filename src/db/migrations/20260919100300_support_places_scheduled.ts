import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("disputes", (t) => {
    t.timestamp("sla_due_at", { useTz: true });
    t.timestamp("first_response_at", { useTz: true });
    t.boolean("escalated").notNullable().defaultTo(false);
    t.timestamp("escalated_at", { useTz: true });
    t.text("description");
  });
  await knex.schema.alterTable("support_tickets", (t) => {
    t.timestamp("sla_due_at", { useTz: true });
    t.timestamp("first_response_at", { useTz: true });
    t.boolean("escalated").notNullable().defaultTo(false);
    t.timestamp("escalated_at", { useTz: true });
  });

  await knex.schema.createTable("ticket_messages", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("ticket_id").notNullable().references("id").inTable("support_tickets").onDelete("CASCADE");
    t.uuid("author_id").references("id").inTable("users").onDelete("SET NULL");
    t.string("author_role", 10).notNullable(); // "you" (the requester) | "support"
    t.text("body").notNullable();
    t.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(["ticket_id", "created_at"]);
  });

  // DB-backed place catalogue behind the GeocodingProvider interface (no third-party maps provider).
  await knex.schema.createTable("places_catalog", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("label", 150).notNullable();
    t.string("subtitle", 255);
    t.string("city", 100).notNullable().defaultTo("Lagos");
    t.decimal("lat", 10, 7).notNullable();
    t.decimal("lng", 10, 7).notNullable();
    t.string("aliases", 500); // space-separated extra search terms
    t.index(["city"]);
  });

  await knex.schema.createTable("scheduled_rides", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("commuter_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("category", 10).notNullable();
    t.string("pickup_label", 150).notNullable();
    t.decimal("pickup_lat", 10, 7).notNullable();
    t.decimal("pickup_lng", 10, 7).notNullable();
    t.string("destination_label", 150).notNullable();
    t.decimal("destination_lat", 10, 7).notNullable();
    t.decimal("destination_lng", 10, 7).notNullable();
    t.timestamp("scheduled_for", { useTz: true }).notNullable();
    t.bigInteger("fare_estimate"); // kobo
    t.uuid("payment_method_id").references("id").inTable("payment_methods").onDelete("SET NULL");
    t.string("promo_code", 40);
    t.string("note", 255);
    t.string("status", 12).notNullable().defaultTo("scheduled"); // scheduled | cancelled | dispatched
    t.uuid("trip_id").references("id").inTable("trips").onDelete("SET NULL");
    t.timestamps(true, true);
    t.index(["commuter_id", "status", "scheduled_for"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("scheduled_rides");
  await knex.schema.dropTableIfExists("places_catalog");
  await knex.schema.dropTableIfExists("ticket_messages");
  await knex.schema.alterTable("support_tickets", (t) => {
    for (const c of ["sla_due_at", "first_response_at", "escalated", "escalated_at"]) t.dropColumn(c);
  });
  await knex.schema.alterTable("disputes", (t) => {
    for (const c of ["sla_due_at", "first_response_at", "escalated", "escalated_at", "description"]) t.dropColumn(c);
  });
}
