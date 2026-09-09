import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postJson } from "./use-cursor-mutation";

/**
 * `postJson` is tested on its own, and the hook around it is not.
 *
 * This function holds the whole contract worth pinning: read the server's
 * `{ error }` when there is one, invent something useful when there is not,
 * and do not try to parse a body that does not exist. The hook is thirty lines
 * of TanStack wiring on top, and testing it would mostly test TanStack.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A response, with the `headers` a real one always has. */
function reply(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => {
      if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
      return body;
    },
  };
}

describe("postJson", () => {
  it("sends JSON and returns the parsed body", async () => {
    fetchMock.mockResolvedValue(reply(200, { id: "abc" }));

    await expect(postJson("/api/compose/send", { to: "a@b.c" })).resolves.toEqual({
      id: "abc",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/compose/send");
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"to":"a@b.c"}');
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
  });

  it("never lets a write be answered from a cache", async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    await postJson("/api/x", {});
    expect(fetchMock.mock.calls[0]?.[1].cache).toBe("no-store");
  });

  it("sends no body at all when there is nothing to send", async () => {
    // Right for a route that acts on the session alone. An empty `{}` would
    // be a body the route has to decide to ignore.
    fetchMock.mockResolvedValue(reply(204));
    await postJson("/api/inbox/sync", undefined);
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });

  it("survives a 204, which has no body to parse", async () => {
    // `response.json()` on a 204 throws, which turned a successful delete into
    // an error in the hand-written version this replaces.
    fetchMock.mockResolvedValue(reply(204));
    await expect(postJson("/api/x", {}, "DELETE")).resolves.toBeUndefined();
  });

  it("throws the server's own sentence", async () => {
    /**
     * The reason this exists. Every route answers a failure with
     * `{ error: string }`, and the hand-written callers that skipped reading
     * it showed "Something went wrong" over a server that had just explained
     * exactly what was wrong.
     */
    fetchMock.mockResolvedValue(reply(400, { error: "That address is suppressed." }));
    await expect(postJson("/api/x", {})).rejects.toThrow("That address is suppressed.");
  });

  it("says something useful when the body is not JSON", async () => {
    // A proxy timeout or a gateway error returns HTML, and `json()` throws.
    // "undefined" is not a message.
    fetchMock.mockResolvedValue(reply(502));
    await expect(postJson("/api/x", {})).rejects.toThrow(/retrying/i);
  });

  it.each([
    [401, /session has expired/i],
    [403, /permission/i],
    [404, /no longer there/i],
    [429, /too many requests/i],
    [500, /could not complete/i],
  ])("explains a bare %i", async (status, expected) => {
    fetchMock.mockResolvedValue(reply(status));
    await expect(postJson("/api/x", {})).rejects.toThrow(expected);
  });

  it("prefers the server's message over its own for a known status", async () => {
    // The status-derived sentences are a fallback, not an override: a route
    // that says why it returned 403 knows better than this file does.
    fetchMock.mockResolvedValue(reply(403, { error: "Only the owner can do that." }));
    await expect(postJson("/api/x", {})).rejects.toThrow("Only the owner can do that.");
  });

  it("carries the method through for a non-POST write", async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    await postJson("/api/x/1", { starred: true }, "PATCH");
    expect(fetchMock.mock.calls[0]?.[1].method).toBe("PATCH");
  });
});
