import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: "../../.env" });
config({ path: ".env" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env first.");
  process.exit(1);
}

// A dedicated single connection, not the app pool: migrations take locks and
// must not compete with application traffic for a slot.
const sql = postgres(url, { max: 1, prepare: false });

try {
  console.log("running migrations…");
  await migrate(drizzle(sql), { migrationsFolder: "./migrations" });
  console.log("migrations complete");
} catch (error) {
  console.error("migration failed:", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
