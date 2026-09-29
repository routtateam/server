import { execSync } from "node:child_process";

// Runs the project's own knex CLI (through tsx, exactly like `npm run migrate:latest` / `npm run seed:run`)
// against the throwaway database so the suite tests the real migrations and seeds.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Set TEST_DATABASE_URL to a throwaway Postgres database (name must contain 'test').");
  const dbName = new URL(url).pathname.replace("/", "");
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run: database "${dbName}" does not look like a test database (seeds delete data).`);

  const env = { ...process.env, DATABASE_URL: url, NODE_ENV: "test" };
  const knex = "npx tsx node_modules/knex/bin/cli.js --knexfile knexfile.ts";
  execSync(`${knex} migrate:latest`, { env, stdio: "pipe", cwd: process.cwd() });
  execSync(`${knex} seed:run`, { env, stdio: "pipe", cwd: process.cwd() });
}
