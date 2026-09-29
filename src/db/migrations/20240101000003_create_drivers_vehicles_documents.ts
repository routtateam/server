import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("driver_profiles", (t) => {
    t.uuid("user_id").primary().references("id").inTable("users").onDelete("CASCADE");
    t.string("city", 100);
    t.string("license_number", 100);
    t.integer("total_trips").notNullable().defaultTo(0);
    t.bigInteger("total_earned").notNullable().defaultTo(0); // minor units (kobo)
    t.integer("member_since_year");
    t.boolean("verified").notNullable().defaultTo(false);
    t.decimal("service_fee_pct", 5, 2).notNullable().defaultTo(15.0);
    t.decimal("acceptance_rate", 5, 2).notNullable().defaultTo(100.0);
    t.boolean("online").notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable("vehicles", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.uuid("driver_id").notNullable().references("user_id").inTable("driver_profiles").onDelete("CASCADE");
    t.enu("category", ["bike", "car", "bus", "van"], { useNative: true, enumName: "vehicle_category_enum" }).notNullable();
    t.string("make", 100);
    t.string("model", 100);
    t.integer("year");
    t.string("colour", 50);
    t.string("plate", 20).notNullable();
    t.integer("seats");
    t.date("inspection_last_passed");
    t.date("inspection_expires");
    t.boolean("is_active").notNullable().defaultTo(true);
    t.timestamps(true, true);

    t.index(["driver_id"]);
    t.unique(["plate"]);
  });

  await knex.schema.createTable("documents", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.enu("owner_type", ["driver", "business", "vehicle"], {
      useNative: true,
      enumName: "document_owner_type_enum",
    }).notNullable();
    t.uuid("owner_id").notNullable();
    t.string("doc_key", 50).notNullable(); // licence | inspection | insurance | registration | address | nin | ...
    t.string("doc_name", 150).notNullable();
    t.string("file_url", 500);
    t.enu("status", ["missing", "pending", "current", "expiring", "expired", "rejected"], {
      useNative: true,
      enumName: "document_status_enum",
    })
      .notNullable()
      .defaultTo("missing");
    t.string("meta", 255);
    t.uuid("reviewed_by").references("id").inTable("users");
    t.timestamp("reviewed_at", { useTz: true });
    t.date("expires_at");
    t.timestamps(true, true);

    t.index(["owner_type", "owner_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("documents");
  await knex.schema.dropTableIfExists("vehicles");
  await knex.schema.dropTableIfExists("driver_profiles");
  await knex.raw("DROP TYPE IF EXISTS document_status_enum");
  await knex.raw("DROP TYPE IF EXISTS document_owner_type_enum");
  await knex.raw("DROP TYPE IF EXISTS vehicle_category_enum");
}
