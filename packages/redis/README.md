# @sendstack/redis

The optional Redis layer for [Sendstack](../../README.md): a four-operation
backend behind two transports, plus the two things the app actually does with
it — fan out realtime events to browsers, and short-circuit duplicate webhook
deliveries before they cost a database round trip.

Optional is the word that matters. Every caller behaves correctly with no
Redis configured, and every caller must keep behaving correctly when Redis is
configured and then falls over. Postgres is the source of truth; this package
is latency.

## What it does, in one picture

```text
Resend webhook ──▶ route handler ──▶ claimOnce()  (SET NX, fails open)
                        │
                        ├──▶ INSERT … ON CONFLICT DO NOTHING   ← the real dedupe
                        │
                        └──▶ publishRealtime(event) ──▶ Redis PUBLISH
                                                            │
browser ◀── SSE ◀── /api/realtime/stream ◀── subscribeRealtime() ◀┘
```

A webhook lands on whichever instance the platform picks, which is almost
never the one holding a given browser's SSE connection. Redis bridges them.
Without it the stream stays open and idle and the UI refreshes on navigation.

## Where it is used

Two importers, and a small surface each — which is what keeps the blast radius
of a change here knowable.

| File | Imports | For |
| --- | --- | --- |
| `apps/web/src/app/api/webhooks/resend/route.ts` | `claimOnce`, `releaseClaim`, `publishRealtime` | The dedupe pre-filter in front of the `email_events` insert, and the post-commit fan-out |
| `apps/web/src/app/api/realtime/stream/route.ts` | `subscribeRealtime` | The SSE endpoint the browser holds open. It owns the subscription's lifetime |
| `apps/web/src/actions/inbox.ts`, `actions/thread.ts` | `publishRealtime` | Telling other tabs a thread was read, archived or replied to |
| `apps/web/src/actions/setup.ts` | `backendFor`, `parseRedisTarget`, `RedisConfigError`, `resetRedisClient` | The wizard's Test button, which probes credentials that have not been saved |
| `apps/web/src/actions/settings.ts` | `resetRedisClient` | Dropping the cached backend after the URL or token changes |
| `apps/web/src/app/(app)/settings/page.tsx` | `redisTransport` | The "Connected over…" badge |
| `packages/jobs/src/functions/send-campaign.ts` | `publishRealtime` | Campaign progress, per batch |
| `packages/jobs/src/inbound-store.ts` | `publishRealtime` | Announcing a received message, after its row is committed |

Note what is *not* in that list. No query module imports this package, and
nothing reads from Redis to answer a request — every consumer either publishes
or subscribes. That is the shape PRODUCT.md's second invariant requires:
realtime is a latency optimisation, so no read path may depend on it.

## Public API

Everything a consumer may import comes from `src/index.ts`. Nothing else in
the package is a contract.

| Export | Purpose |
| --- | --- |
| `redisBackend()` | The cached backend for the configured target, or `null` when none is configured or the URL is malformed. Rebuilds itself when the stored URL or token changes. |
| `requireRedis()` | `redisBackend()` that throws with a settings-page hint instead of returning `null`. **Nothing calls it today**, and it must never be called on a request path — that would turn an optional dependency into a required one. The wizard's Test button does not use it: it probes *unsaved* credentials, so it goes to `backendFor` and `parseRedisTarget` directly, deliberately bypassing the cache. |
| `resetRedisClient()` | Drop the cached backend. Called by the settings and setup actions after a save, so the next request connects to the new target. |
| `isRedisConfigured()` | Whether `redisBackend()` would return a client. |
| `redisTransport()` | `"tcp"`, `"upstash"` or `null`, for the Settings page badge. |
| `backendFor(target, { probe })` | Build a backend for an explicit target without touching the cache. `probe: true` fails on the first refused connection instead of retrying — for testing credentials someone just typed. |
| `publishRealtime(event)` | Publish a schema-validated `RealtimeEvent`. Never throws; a failed publish is logged and the request that triggered it succeeds regardless. |
| `subscribeRealtime(onEvent, onError?, onClose?)` | Subscribe to the realtime channel on a dedicated connection. Returns `null` when Redis is unconfigured. Drops any payload that fails `parseRealtimeEvent`. The caller must `close()` it; `onClose` fires when this package ends it because the target changed or the client was reset. |
| `claimOnce(key, ttlSeconds?)` | `true` the first time a key is seen within the TTL, `false` on a replay. Returns `true` when Redis is absent or errors. |
| `releaseClaim(key)` | Hand a won claim back. Call it when the write the claim guarded has failed, so the retry is treated as a first delivery. Never throws. |
| `parseRedisTarget(url, token)` | Decide the transport from the URL scheme. Throws `RedisConfigError` for an `https://` URL with no token, or a URL that is neither scheme. |
| `targetSignature(target)` | Stable identity for a target, used to decide whether the cached backend still matches. |
| `RedisConfigError`, `RedisBackend`, `RedisTarget`, `RedisSubscription` | The types and the one error class. |

## The two transports

| URL scheme | Client | Token | Chosen for |
| --- | --- | --- | --- |
| `redis://`, `rediss://` | `@redis/client` over TCP | Not used — credentials live in the URL | Local development, Redis Cloud, Railway, Fly, a Redis on the same box. Holds a socket, so it pays a connect on every serverless cold start and cannot run on an edge runtime. The subscriber reconnects and re-subscribes on its own. |
| `https://` | `@upstash/redis` over REST | Required | Serverless and edge. Stateless, so nothing is held between invocations. Pub/sub rides Upstash's SSE-based `SUBSCRIBE`, which does **not** reconnect when the HTTP stream ends — the SSE route bounds each stream's lifetime so the browser reconnects instead. |

The scheme decides; there is no separate "transport" setting. That is what lets
`redis://localhost:6379` and an Upstash REST URL sit in the same field of the
setup wizard. Both transports implement the same `RedisBackend`:

```ts
type RedisBackend = {
  kind: "upstash" | "tcp";
  publish(channel, message): Promise<void>;
  setNx(key, value, ttlSeconds): Promise<boolean>;   // SET NX EX — true when this caller won
  del(key): Promise<void>;                           // hand a claim back
  subscribe(channel, onMessage, onError?): Promise<RedisSubscription>;
  ping(): Promise<void>;
  close(): Promise<void>;
};
```

Four operations, on purpose. The interface is small enough that two very
different clients stay interchangeable; the moment it grows a `zadd` or an
`eval` the backends stop being interchangeable and start being a compatibility
project.

Both transports run on the same time budget: a two-second connect (three for
an Upstash request) and one retry, then the wrappers fail open. After a failed
connect the TCP backend refuses further attempts for thirty seconds, so a dead
Redis costs one timeout per half-minute rather than one per request.

## Invariants — what an edit must preserve

These are the rules the rest of the app is written against. Breaking one does
not fail a test loudly; it produces a bug that reports nothing.

1. **Absent Redis is a valid state.** `redisBackend()` returns `null`, and
   every function in this package has a defined behaviour for `null`:
   publish is a no-op, subscribe returns `null`, `claimOnce` returns `true`.
   A new operation needs the same answer written down before it is used.
2. **A Redis failure never fails the request.** `publishRealtime` and
   `claimOnce` catch everything and log. The event they were about is already
   committed to Postgres; the browser sees it on its next fetch. If you add a
   call site that can throw, wrap it the same way.
3. **`claimOnce` is a pre-filter, never the guarantee.** It fails open. The
   unique index on `email_events.provider_event_id` is what actually stops a
   replayed webhook running its side effects twice. Do not use `claimOnce` in
   front of a write that has no such database backstop.
4. **A won claim is released when the guarded write fails.** Otherwise Redis
   answers "already seen" to the retry for the whole TTL and the row Postgres
   never received is never received — a lost event that happens only *with*
   Redis configured. Every `claimOnce` caller pairs it with `releaseClaim` on
   its failure path.
5. **Payloads are validated on both ends.** Publishers send a `RealtimeEvent`
   from `@sendstack/shared`; the subscriber runs `parseRealtimeEvent` and
   drops anything that does not match. A stale deploy publishing an old shape
   must not be able to corrupt a newer client. New event types are added to
   `packages/shared/src/realtime.ts`, never described ad hoc here.
6. **Pub/sub gets its own connection.** A subscribed Redis connection cannot
   run ordinary commands — a protocol rule. `subscribe()` opens a dedicated
   client and returns a `close()`; the SSE route calls it on `request.signal`
   abort, on a failed write, and at its four-minute lifetime cap. A
   subscription that is not closed leaks for the life of the instance.
7. **The cache follows the configuration, and so do the subscriptions.**
   `redisBackend()` compares `targetSignature()` against the cached one and
   rebuilds when it differs; the settings actions also call
   `resetRedisClient()` after a save. Both are needed: the signature handles a
   second instance that never saw the save, the reset handles the instance
   that did. Either path ends every live subscription through
   `trackSubscription`, and the owner's `onClose` ends the client stream so
   the browser reconnects onto the new target.
8. **Every Redis call on a request path has a hard time budget.** Connect
   and request timeouts are set on both backends and there is one retry. An
   unreachable Redis must cost a request a couple of seconds once, not most
   of a minute on every request.
9. **Node runtime only for TCP.** Routes that may hit the TCP backend declare
   `export const runtime = "nodejs"`. An edge route with a `redis://` URL
   fails at connect time, not at build time.
10. **Errors are handled on every `@redis/client` instance.** An unhandled
   `error` event on a Node EventEmitter takes the process down.
   `attachErrorHandler` exists for that reason; every `createClient` call goes
   through it.

## Editing the package

**Adding an operation.** Add it to `RedisBackend` in `backend.ts`, implement
it in *both* `backend-tcp.ts` and `backend-upstash.ts` in the same change, and
add it to the fake backend in `client.test.ts`. Check the units: node-redis
takes `expiration: { type: "EX", value }`, Upstash takes `{ ex }` — both in
seconds. Then decide what the operation does when the backend is `null` and
when it throws, and write both into the wrapper in `once.ts` or `realtime.ts`
(or a new sibling) rather than leaving the decision to each caller. Add a test
for each of those two answers beside the existing ones.

**Adding a realtime event.** Add the variant to the discriminated union in
`packages/shared/src/realtime.ts`. Publish it with `publishRealtime`. The
subscriber and the browser hook pick it up through the shared parser; nothing
in this package changes.

**Changing connection behaviour.** Timeouts, reconnect strategy and the probe
mode live in `backend-tcp.ts`. The reconnect strategy is capped on purpose — a
serverless invocation must not keep reconnecting in the background after its
response has been sent.

**Do not** import `@sendstack/db` here. This package sits beside the
database, not on top of it; the dedupe backstop belongs to the schema and the
route, and pulling Postgres into the Redis layer would invert that.

## Testing

Unit tests need no Redis:

```bash
npx vitest run packages/redis
```

`backend.test.ts` covers `parseRedisTarget` and `targetSignature` — the
scheme detection and the cache identity. `client.test.ts` covers the runtime
invariants above through a fake `RedisBackend`: fail-open, never-throw, claim
release, invalid payloads dropped, and subscriptions ended on
reconfiguration. The two real backends have no automated test; they are
checked by hand against a real server as described below.

The webhook route has its own two tests: `route.release.test.ts` proves the
claim is released when the database insert fails, and
`route.integration.test.ts` runs the handler twice against a real Postgres
with Redis mocked as absent and asserts one `email_events` row — the proof
that the index, not the claim, is the guarantee.

**With a local Redis:**

```bash
docker compose up -d redis          # or any redis:// you have
```

Set the URL in Settings → Infrastructure → Live updates (or seed `REDIS_URL`
in `.env` before first run). The Settings page shows "Connected over the Redis
protocol" when `ping()` succeeds. Open the inbox in two browsers and send a
test webhook; the second browser should update without a refresh.

**With Upstash:** paste the REST URL and token from the Upstash dashboard into
the same field. The badge reads "Connected over Upstash REST".

**Without Redis:** clear the URL. The app must keep working — the inbox
updates on navigation, the webhook route answers `deduped: "database"` on a
replay instead of `deduped: "redis"`, and nothing logs an error. If any of
those three changes, a caller has started depending on Redis and needs fixing.

## Files

| File | Holds |
| --- | --- |
| `backend.ts` | The `RedisBackend` interface, `RedisTarget`, `parseRedisTarget`, `targetSignature`, `RedisConfigError`. |
| `backend-tcp.ts` | The `@redis/client` implementation: lazy shared connection, dedicated subscriber, capped reconnects, error handlers. |
| `backend-upstash.ts` | The `@upstash/redis` implementation over REST. |
| `client.ts` | The cached backend built from `getConfig()`, the live-subscription registry, and the reset/probe helpers. |
| `once.ts` | `claimOnce`, `releaseClaim`. |
| `realtime.ts` | `publishRealtime`, `subscribeRealtime`. |
| `index.ts` | The public surface. |
