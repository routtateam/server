import type { Knex } from "knex";

// Stores each driver's last-known GPS fix, reported by the mobile app while online (see
// PATCH /drivers/me/location). Only the latest position is kept — this is presence, not a
// location-history trail; add a separate table later if trip-by-trip breadcrumb history is needed.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("driver_profiles", (t) => {
    t.decimal("last_lat", 9, 6);
    t.decimal("last_lng", 9, 6);
    t.timestamp("last_location_at");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("driver_profiles", (t) => {
    t.dropColumn("last_lat");
    t.dropColumn("last_lng");
    t.dropColumn("last_location_at");
  });
}
