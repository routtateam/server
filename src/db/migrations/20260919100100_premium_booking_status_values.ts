import type { Knex } from "knex";

// ALTER TYPE ... ADD VALUE is kept out of a transaction so the new labels are usable by later migrations.
export const config = { transaction: false };

export async function up(knex: Knex): Promise<void> {
  for (const v of ["requested", "declined", "expired"]) {
    await knex.raw(`ALTER TYPE premium_booking_status_enum ADD VALUE IF NOT EXISTS '${v}'`);
  }
}

export async function down(): Promise<void> {
  // Postgres cannot drop enum labels; leaving them is harmless.
}
