// Shared Knex instance used by every module's repository layer.
import knexLib, { type Knex } from "knex";
import { env } from "@/config/env";

const connection = env.db.url
  ? env.db.url
  : {
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.name,
      ssl: env.db.ssl ? { rejectUnauthorized: false } : undefined,
    };

export const db: Knex = knexLib({
  client: "pg",
  connection,
  pool: { min: env.db.poolMin, max: env.db.poolMax },
});

export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.raw("select 1");
    return true;
  } catch {
    return false;
  }
}
