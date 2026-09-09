import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load the repo-root .env so `pnpm db:generate` works from anywhere.
config({ path: "../../.env" });

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
