import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sendBatch` against a stubbed Resend client.
 *
 * The distinction under test is the one that decides whether a provider
 * hiccup costs a hundred recipients: a transport-level error must *throw* so
 * the job retries, while a per-item rejection is final for that item alone.
 */
const send = vi.fn();

vi.mock("./client", () => ({
  resendClient: async () => ({ batch: { send } }),
}));

const { BatchTransportError, sendBatch } = await import("./send");

const messages = [
  { recipientId: "r1", to: "a@example.com", from: "x <x@example.com>", subject: "s", html: "<p/>" },
  { recipientId: "r2", to: "b@example.com", from: "x <x@example.com>", subject: "s", html: "<p/>" },
  { recipientId: "r3", to: "c@example.com", from: "x <x@example.com>", subject: "s", html: "<p/>" },
];

beforeEach(() => {
  send.mockReset();
});

describe("sendBatch", () => {
  it("throws a retryable error when the whole batch is refused", async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: "rate_limit_exceeded", message: "Too many requests" },
    });

    const attempt = sendBatch(messages, { idempotencyKey: "k" });
    await expect(attempt).rejects.toBeInstanceOf(BatchTransportError);
    await expect(attempt).rejects.toMatchObject({ code: "rate_limit_exceeded" });
    // Whatever it is, it must not be the class Inngest refuses to retry.
    await expect(attempt).rejects.not.toHaveProperty("name", "NonRetriableError");
  });

  it("throws when the provider returns neither data nor error", async () => {
    send.mockResolvedValue({ data: null, error: null });
    await expect(sendBatch(messages, { idempotencyKey: "k" })).rejects.toThrow(/no data/);
  });

  it("reports a per-item rejection as failed and keeps the rest paired", async () => {
    send.mockResolvedValue({
      error: null,
      data: {
        // Only the accepted messages come back, so the ids no longer line up
        // with the input by position once one has been refused.
        data: [{ id: "m1" }, { id: "m3" }],
        errors: [{ index: 1, message: "Invalid `to` address" }],
      },
    });

    const outcome = await sendBatch(messages, { idempotencyKey: "k" });

    expect(outcome.failed).toEqual([{ recipientId: "r2", error: "Invalid `to` address" }]);
    expect(outcome.sent).toEqual([
      { recipientId: "r1", providerMessageId: "m1" },
      { recipientId: "r3", providerMessageId: "m3" },
    ]);
  });

  it("passes the idempotency key and permissive validation through", async () => {
    send.mockResolvedValue({ error: null, data: { data: [], errors: [] } });
    await sendBatch(messages.slice(0, 1), { idempotencyKey: "campaign:c:run:0" });

    expect(send).toHaveBeenCalledWith(expect.any(Array), {
      batchValidation: "permissive",
      idempotencyKey: "campaign:c:run:0",
    });
  });

  it("does not call the provider for an empty batch", async () => {
    expect(await sendBatch([], { idempotencyKey: "k" })).toEqual({ sent: [], failed: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
