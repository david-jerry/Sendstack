import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which status the offline outbox is given for each way a send can fail.
 *
 * The worker's replay policy — `isRetryable` in `packages/pwa/src/sw/create.js`
 * — retries 5xx, 408 and 429 and treats everything else as final. So the
 * status this route picks *is* the retry policy for a queued send, and getting
 * it wrong is invisible from here: the message simply never arrives and the
 * person is never told.
 *
 * Two answers, one route:
 *
 *  - **A provider fault is 502**, because the same body a minute later goes
 *    out fine.
 *  - **A suppression refusal is 409**, because it will be refused identically
 *    on every attempt. It used to be a 502, so the outbox replayed a message
 *    that could never be accepted, and no failure was surfaced until
 *    Background Sync gave up.
 */
const mocks = vi.hoisted(() => ({
  session: { user: { id: "u1" } } as unknown as object | null,
  sendSingleEmail: vi.fn(async () => ({ ok: true, id: "msg_1" }) as { ok: boolean; id?: string; error?: string }),
  assertNotSuppressed: vi.fn(async () => null as { email: string; reason: string } | null),
}));

vi.mock("@sendstack/auth", () => ({ getSession: async () => mocks.session }));
vi.mock("@/actions/compose", () => ({ sendSingleEmail: mocks.sendSingleEmail }));
/**
 * `suppressedMessage` is the real one, deliberately.
 *
 * The wording the recipient's sender sees is the point of the 409 — a status
 * the worker drops silently would be no better than the retry loop it
 * replaces — and it is shared with every other send path. Stubbing it would
 * let the route return an empty body and still pass.
 */
vi.mock("@/lib/queries/suppressions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/suppressions")>();
  return { ...actual, assertNotSuppressed: mocks.assertNotSuppressed };
});

const { POST } = await import("./route");

/** A body that satisfies `composeSendSchema`, so parsing is never the failure. */
function send(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/compose/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        to: "bob@example.com",
        cc: "",
        bcc: "",
        subject: "Hello",
        html: "<p>Hi</p>",
        ...overrides,
      }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { user: { id: "u1" } };
  mocks.sendSingleEmail.mockResolvedValue({ ok: true, id: "msg_1" });
  mocks.assertNotSuppressed.mockResolvedValue(null);
});

describe("POST /api/compose/send", () => {
  it("sends a valid message", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: "msg_1" });
  });

  it("asks the worker to retry a provider failure", async () => {
    mocks.sendSingleEmail.mockResolvedValue({ ok: false, error: "Resend timed out" });
    const response = await send();
    // 5xx, so `isRetryable` keeps the entry queued.
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Resend timed out" });
  });

  it("refuses a suppressed recipient with a status the worker will not retry", async () => {
    mocks.assertNotSuppressed.mockResolvedValue({
      email: "bob@example.com",
      reason: "hard_bounce",
    });

    const response = await send();

    expect(response.status).toBe(409);
    expect(response.status).toBeLessThan(500);
    // Not 408 or 429 either — the two 4xx the worker does retry.
    expect([408, 429]).not.toContain(response.status);
    expect((await response.json()).error).toContain("bob@example.com is suppressed");
    // And no provider call was made for a message that could never be accepted.
    expect(mocks.sendSingleEmail).not.toHaveBeenCalled();
  });

  it("checks every recipient field, not just To", async () => {
    // A suppressed address hidden in Bcc is the one a caller is least likely
    // to notice, and `splitAddressList` is what turns the field into
    // addresses — the same splitter the send path uses.
    mocks.assertNotSuppressed.mockResolvedValue({ email: "eve@example.com", reason: "complaint" });
    await send({ cc: "carol@example.com", bcc: "eve@example.com, dave@example.com" });

    expect(mocks.assertNotSuppressed).toHaveBeenCalledWith([
      "bob@example.com",
      "carol@example.com",
      "eve@example.com",
      "dave@example.com",
    ]);
  });

  it("rejects an unauthenticated request before touching the database", async () => {
    mocks.session = null;
    const response = await send();
    expect(response.status).toBe(401);
    expect(mocks.assertNotSuppressed).not.toHaveBeenCalled();
  });

  it("rejects a body the schema refuses", async () => {
    const response = await send({ subject: "" });
    expect(response.status).toBe(400);
    expect(mocks.assertNotSuppressed).not.toHaveBeenCalled();
  });
});
