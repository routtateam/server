import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("payouts", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("driver_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.bigInteger("amount").notNullable();
    t.bigInteger("fee").notNullable().defaultTo(0);
    t.bigInteger("net").notNullable();
    t.jsonb("bank_snapshot"); // {bankName, accountNumber, accountName}
    t.enu("status", ["pending", "processing", "paid", "failed"], { useNative: true, enumName: "payout_status_enum" })
      .notNullable()
      .defaultTo("pending");
    t.string("reference", 100).unique();
    t.timestamp("requested_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp("processed_at", { useTz: true });
    t.timestamps(true, true);

    t.index(["driver_id"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("pricing_rules", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.enu("category", ["bike", "car", "bus", "van"], { useNative: true, enumName: "pricing_category_enum" })
      .notNullable()
      .unique();
    t.string("name", 100).notNullable();
    t.string("caption", 200);
    t.decimal("fee_percent", 5, 2).notNullable().defaultTo(15.0);
    t.bigInteger("rate_per_km").notNullable(); // minor units
    t.string("sample", 100);
    t.timestamps(true, true);
  });

  await knex.schema.createTable("premium_pricing_rules", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("key", 40).notNullable().unique(); // commission | service | deposit | overstay
    t.string("label", 100).notNullable();
    t.string("sub", 200);
    t.decimal("value", 10, 2).notNullable();
    t.string("unit", 20).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable("admin_invites", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("email", 255).notNullable();
    t.uuid("role_id").notNullable().references("id").inTable("roles");
    t.uuid("invited_by").references("id").inTable("users");
    t.enu("status", ["pending", "accepted", "revoked"], { useNative: true, enumName: "invite_status_enum" })
      .notNullable()
      .defaultTo("pending");
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("admin_invites");
  await knex.schema.dropTableIfExists("premium_pricing_rules");
  await knex.schema.dropTableIfExists("pricing_rules");
  await knex.schema.dropTableIfExists("payouts");

  for (const t of ["invite_status_enum", "pricing_category_enum", "payout_status_enum"]) {
    await knex.raw(`DROP TYPE IF EXISTS ${t}`);
  }
}
