import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.enu("user_type", ["commuter", "driver", "admin", "business"], {
      useNative: true,
      enumName: "user_type_enum",
    }).notNullable();
    t.string("first_name", 100);
    t.string("last_name", 100);
    t.string("email", 255).unique();
    t.boolean("email_verified").notNullable().defaultTo(false);
    t.string("phone", 32).unique();
    t.boolean("phone_verified").notNullable().defaultTo(false);
    t.string("password_hash", 255); // null for OTP-only commuter/driver accounts
    t.string("avatar_url", 500);
    t.decimal("rating", 3, 2).notNullable().defaultTo(5.0);
    t.enu("status", ["active", "suspended", "pending", "flagged"], {
      useNative: true,
      enumName: "user_status_enum",
    })
      .notNullable()
      .defaultTo("active");
    t.string("referral_code", 32).unique();
    t.timestamp("last_active_at", { useTz: true });
    t.timestamps(true, true);

    t.index(["user_type"]);
    t.index(["status"]);
  });

  await knex.schema.createTable("otps", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("identifier", 255).notNullable(); // phone or email
    t.enu("channel", ["sms", "email"], { useNative: true, enumName: "otp_channel_enum" }).notNullable();
    t.string("purpose", 50).notNullable().defaultTo("login"); // login | signup | reset
    t.string("code_hash", 255).notNullable();
    t.integer("attempts").notNullable().defaultTo(0);
    t.timestamp("expires_at", { useTz: true }).notNullable();
    t.timestamp("consumed_at", { useTz: true });
    t.timestamps(true, true);

    t.index(["identifier"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("otps");
  await knex.schema.dropTableIfExists("users");
  await knex.raw("DROP TYPE IF EXISTS user_type_enum");
  await knex.raw("DROP TYPE IF EXISTS user_status_enum");
  await knex.raw("DROP TYPE IF EXISTS otp_channel_enum");
}
