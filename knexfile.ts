// Knex CLI configuration (migrations + seeds).
// Loaded via `--knexfile knexfile.ts` by the npm scripts in package.json.
import type { Knex } from "knex";
import "dotenv/config";

const connection = process.env.DATABASE_URL
  ? process.env.DATABASE_URL
  : {
      host: process.env.DB_HOST ?? "localhost",
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER ?? "routta",
      password: process.env.DB_PASSWORD ?? "routta",
      database: process.env.DB_NAME ?? "routta_dev",
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
    };

const base: Knex.Config = {
  client: "pg",
  connection,
  pool: {
    min: Number(process.env.DB_POOL_MIN ?? 2),
    max: Number(process.env.DB_POOL_MAX ?? 10),
  },
  migrations: {
    directory: "./src/db/migrations",
    extension: "ts",
    tableName: "knex_migrations",
  },
  seeds: {
    directory: "./src/db/seeds",
    extension: "ts",
  },
};

const config: Record<string, Knex.Config> = {
  development: base,
  test: { ...base },
  production: base,
};

export default config;
