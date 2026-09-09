import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

type DrizzleClient = ReturnType<typeof createClient>;

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres instance " +
        "(Neon, Supabase, or a local `docker compose up`), or complete the setup wizard.",
    );
  }
  return url;
}

/**
 * postgres.js rather than a Neon-specific driver, deliberately: this connects
 * to Neon, Supabase, RDS or a Postgres in Docker with no code change, which is
 * the point of a self-hostable project.
 *
 * `prepare: false` is required when the URL points at a transaction-mode
 * pooler (Neon's `-pooler` host, Supabase port 6543, any PgBouncer). Named
 * prepared statements do not survive a connection being handed to another
 * client mid-transaction, and the failure looks like random query errors under
 * load. The cost of leaving it off is small; the cost of getting it wrong is a
 * heisenbug.
 */
function createClient() {
  const sql = postgres(connectionString(), {
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  return drizzle(sql, { schema, casing: "snake_case" });
}

declare global {
  // eslint-disable-next-line no-var
  var __sendstackDb: DrizzleClient | undefined;
}

/**
 * One pool per process, created on first *use* rather than on import.
 *
 * The laziness is not an optimisation — it is what lets this module be
 * imported when no database is configured yet. The setup wizard is the whole
 * reason: it exists to collect DATABASE_URL, and it transitively imports this
 * file, so an eager `createClient()` would crash the one page able to fix the
 * problem. The same applies to any tool that imports the schema for types or
 * migrations without intending to connect.
 *
 * The global cache matters separately: Next re-evaluates modules on every hot
 * reload, and without it a long dev session opens hundreds of connections and
 * exhausts the database's limit.
 */
function resolveDb(): DrizzleClient {
  if (!globalThis.__sendstackDb) globalThis.__sendstackDb = createClient();
  return globalThis.__sendstackDb;
}

export const db: DrizzleClient = new Proxy({} as DrizzleClient, {
  get(_target, property, receiver) {
    const client = resolveDb();
    const value = Reflect.get(client, property, receiver);
    // Drizzle's methods rely on `this`; a plain reference would lose it.
    return typeof value === "function" ? value.bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(resolveDb(), property);
  },
});

export type Database = DrizzleClient;

/**
 * The executor drizzle hands to a `db.transaction` callback.
 *
 * Spelled here rather than in each consumer. `packages/jobs` had two copies
 * of this type expression — `Tx` in the send worker and the transaction arm of
 * `DbExecutor` in the inbound store — and an app route reached into
 * `@sendstack/jobs` to name what is a `@sendstack/db` concept.
 */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Either the pool or a transaction.
 *
 * The type a function takes when it must work both standalone and inside a
 * caller's transaction — `recordInboundEmail` is the example: the webhook
 * route runs it inside the transaction that records the event, and the
 * reconciler calls it on its own.
 */
export type Executor = Database | Transaction;
