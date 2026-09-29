import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("permissions", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("key", 100).notNullable().unique(); // e.g. "trips.view"
    t.string("description", 255);
    t.timestamps(true, true);
  });

  await knex.schema.createTable("roles", (t) => {
    t.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    t.string("name", 100).notNullable().unique(); // e.g. "Super admin"
    t.string("description", 255);
    t.boolean("is_system").notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable("role_permissions", (t) => {
    t.uuid("role_id").notNullable().references("id").inTable("roles").onDelete("CASCADE");
    t.uuid("permission_id").notNullable().references("id").inTable("permissions").onDelete("CASCADE");
    t.primary(["role_id", "permission_id"]);
  });

  await knex.schema.createTable("user_roles", (t) => {
    t.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.uuid("role_id").notNullable().references("id").inTable("roles").onDelete("CASCADE");
    t.primary(["user_id", "role_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("user_roles");
  await knex.schema.dropTableIfExists("role_permissions");
  await knex.schema.dropTableIfExists("roles");
  await knex.schema.dropTableIfExists("permissions");
}
