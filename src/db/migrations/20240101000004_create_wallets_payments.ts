import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("wallets", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("user_id").notNullable().unique().references("id").inTable("users").onDelete("CASCADE");
    t.bigInteger("balance").notNullable().defaultTo(0); // minor units (kobo)
    t.string("currency", 3).notNullable().defaultTo("NGN");
    t.timestamps(true, true);
  });

  await knex.schema.createTable("payment_methods", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.enu("kind", ["card", "wallet", "bank_account"], { useNative: true, enumName: "payment_method_kind_enum" }).notNullable();
    t.string("brand", 20); // visa | verve | mastercard
    t.string("last4", 4);
    t.string("bank", 100);
    t.string("expiry", 10);
    t.string("provider", 20).notNullable().defaultTo("monnify");
    t.string("provider_ref", 255); // Monnify card/customer token
    t.boolean("is_default").notNullable().defaultTo(false);
    t.boolean("expired").notNullable().defaultTo(false);
    t.timestamps(true, true);

    t.index(["user_id"]);
  });

  await knex.schema.createTable("transactions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("wallet_id").references("id").inTable("wallets").onDelete("SET NULL");
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.enu(
      "type",
      ["topup", "fare_payment", "payout", "refund", "adjustment", "commission", "deposit_hold", "deposit_release"],
      { useNative: true, enumName: "transaction_type_enum" }
    ).notNullable();
    t.bigInteger("amount").notNullable(); // minor units (kobo); sign indicates direction
    t.string("currency", 3).notNullable().defaultTo("NGN");
    t.enu("status", ["pending", "successful", "failed", "reversed"], {
      useNative: true,
      enumName: "transaction_status_enum",
    })
      .notNullable()
      .defaultTo("pending");
    t.string("provider", 20); // monnify
    t.string("provider_reference", 255);
    t.uuid("trip_id");
    t.jsonb("metadata");
    t.timestamps(true, true);

    t.index(["user_id"]);
    t.index(["wallet_id"]);
    t.index(["provider_reference"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("transactions");
  await knex.schema.dropTableIfExists("payment_methods");
  await knex.schema.dropTableIfExists("wallets");
  await knex.raw("DROP TYPE IF EXISTS transaction_status_enum");
  await knex.raw("DROP TYPE IF EXISTS transaction_type_enum");
  await knex.raw("DROP TYPE IF EXISTS payment_method_kind_enum");
}
