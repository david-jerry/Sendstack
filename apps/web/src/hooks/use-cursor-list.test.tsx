import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCursorList } from "./use-cursor-list";
import type { Page } from "@/lib/cursor";
import { useConnectivityStore } from "@/stores/connectivity-store";

type Row = { id: string; label: string };

const page = (labels: string[], nextCursor: string | null): Page<Row> => ({
  items: labels.map((label) => ({ id: label, label })),
  nextCursor,
});

function Harness({
  initialPage,
  params,
}: {
  initialPage?: Page<Row> | undefined;
  params?: Record<string, string | undefined>;
}) {
  const list = useCursorList<Row>({
    key: ["rows"],
    path: "/api/rows",
    ...(params ? { params } : {}),
    ...(initialPage ? { initialPage } : {}),
  });

  return (
    <div>
      <ul>
        {list.items.map((row) => (
          <li key={row.id}>{row.label}</li>
        ))}
      </ul>
      <span data-testid="error">{list.error ?? ""}</span>
      <span data-testid="has-more">{String(list.hasMore)}</span>
      <button type="button" onClick={() => void list.loadMore()}>
        more
      </button>
    </div>
  );
}

function renderList(props: React.ComponentProps<typeof Harness> = {}) {
  // No retries in tests: the point is the shape of the result, and a retry
  // just makes a failing assertion take a second longer to arrive.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <Harness {...props} />
    </QueryClientProvider>,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useConnectivityStore.setState({ servedFromCacheAt: null, network: "offline" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * `headers` is not optional dressing.
 *
 * The hook reads `x-sendstack-from-cache` off every response to tell a live
 * answer from one the service worker replayed, so a mock without headers is a
 * mock that does not resemble the platform — and the failure it produces is
 * an unrelated "cannot read properties of undefined".
 */
const ok = (body: unknown, headers: Record<string, string> = {}) => ({
  ok: true,
  headers: new Headers(headers),
  json: async () => body,
});

const failing = (json: () => Promise<unknown>) => ({
  ok: false,
  headers: new Headers(),
  json,
});

describe("useCursorList", () => {
  it("renders the server's page without a request", async () => {
    // The whole reason for seeding: otherwise every navigation puts a spinner
    // over rows that already arrived with the HTML.
    renderList({ initialPage: page(["a", "b"], null) });

    expect(screen.getByText("a")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("appends the next page rather than replacing it", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok(page(["c", "d"], null)));
    renderList({ initialPage: page(["a", "b"], "cursor-1") });

    await user.click(screen.getByRole("button", { name: "more" }));

    await waitFor(() => expect(screen.getByText("c")).toBeInTheDocument());
    // Reading down a mailbox must not lose what was already read.
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("d")).toBeInTheDocument();
  });

  it("sends the cursor it was given, not a page number", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok(page(["c"], null)));
    renderList({ initialPage: page(["a"], "cursor-1") });

    await user.click(screen.getByRole("button", { name: "more" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("cursor=cursor-1");
    expect(url).not.toContain("page=");
  });

  it("stops offering more when the cursor runs out", async () => {
    renderList({ initialPage: page(["a"], null) });
    expect(screen.getByTestId("has-more")).toHaveTextContent("false");
  });

  it("drops empty parameters instead of sending them", async () => {
    fetchMock.mockResolvedValue(ok(page([], null)));
    renderList({ params: { q: "", status: "spam" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("status=spam");
    // `?q=` would be a search for the empty string, which is not the same as
    // no search at all.
    expect(url).not.toContain("q=");
  });

  it("reports a page the service worker replayed from its cache", async () => {
    // The banner's "showing mail as it was 12 minutes ago" is only true if
    // the fetch layer notices. Nothing else in the app looks at these headers.
    const storedAt = new Date(Date.now() - 8 * 60_000);
    fetchMock.mockResolvedValue(
      ok(page(["a"], null), {
        "x-sendstack-from-cache": "1",
        "x-sendstack-cached-at": storedAt.toUTCString(),
      }),
    );
    renderList();

    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(useConnectivityStore.getState().servedFromCacheAt).toBe(
      Math.floor(storedAt.getTime() / 1000) * 1000,
    );
  });

  it("leaves the staleness marker alone for a page the network answered", async () => {
    fetchMock.mockResolvedValue(ok(page(["a"], null)));
    renderList();

    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    expect(useConnectivityStore.getState().servedFromCacheAt).toBeNull();
  });

  it("surfaces the server's message, not a generic failure", async () => {
    fetchMock.mockResolvedValue(failing(async () => ({ error: "Invalid date range" })));
    renderList();

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("Invalid date range"),
    );
  });

  it("says something useful when the response is not even JSON", async () => {
    fetchMock.mockResolvedValue(
      failing(async () => {
        throw new Error("not json");
      }),
    );
    renderList();

    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("Could not load this list."),
    );
  });
});
