import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// The suite needs a THROWAWAY Postgres database (name must contain "test"): globalSetup runs migrations and
// seeds against it. Set TEST_DATABASE_URL, e.g. postgres://routta:routta@localhost:5432/routta_test
export default defineConfig({
  resolve: { alias: { "@": path.resolve(root, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    fileParallelism: false, // tests share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      NODE_ENV: "test",
      JOBS_MODE: "inline", // never touch Redis; background jobs run inline
      LOG_LEVEL: "silent",
      UPLOAD_DIR: path.resolve(root, ".test-uploads"),
    },
  },
});
