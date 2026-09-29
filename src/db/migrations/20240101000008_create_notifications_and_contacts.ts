import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("notifications", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("title", 150).notNullable();
    t.text("body").notNullable();
    t.enu("kind", ["refund", "schedule", "promo", "rating", "referral", "money", "doc", "star", "chat", "zone", "system"], {
      useNative: true,
      enumName: "notification_kind_enum",
    })
      .notNullable()
      .defaultTo("system");
    t.boolean("read").notNullable().defaultTo(false);
    t.timestamps(true, true);

    t.index(["user_id"]);
    t.index(["read"]);
  });

  await knex.schema.createTable("emergency_contacts", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.string("name", 150).notNullable();
    t.string("relation", 100);
    t.string("phone", 32).notNullable();
    t.boolean("is_primary").notNullable().defaultTo(false);
    t.timestamps(true, true);

    t.index(["user_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("emergency_contacts");
  await knex.schema.dropTableIfExists("notifications");
  await knex.raw("DROP TYPE IF EXISTS notification_kind_enum");
}
