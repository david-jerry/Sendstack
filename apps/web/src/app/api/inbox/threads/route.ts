import { getSession } from "@sendstack/auth";
import { z } from "zod";
import { asOptional, clampPageSize, decodeCursor } from "@/lib/cursor";
import { listThreadPage, type InboxThreadSort, type InboxThreadStatus } from "@/lib/queries/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z
    .enum(["all", "unread", "read", "archived", "spam", "trash", "starred", "snoozed"])
    .optional(),
  hasContent: z.enum(["1", "true"]).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sort: z.enum(["newest", "oldest"]).optional(),
  limit: z.coerce.number().int().optional(),
  /** Opaque. Anything unreadable is treated as "start at the top". */
  cursor: z.string().max(512).optional(),
});

/**
 * One page of conversations for a mailbox list.
 *
 * Cursor-paginated rather than offset-paginated. The list it serves is a
 * moving target — mail arrives while it is being read — and with an offset
 * every arrival shifts the whole list down one, so the next page repeats a row
 * and skips the one that was there. A cursor names the row the last page
 * stopped at, so inserts above it cannot disturb the boundary. It is also a
 * single index seek instead of a scan-and-discard, which is what stops page 40
 * costing forty times page 1.
 *
 * Search matches sender, subject and snippet. The date range uses whole UTC
 * days and the upper bound is exclusive, so `to=2026-09-05` includes every
 * message received on that date.
 */
export async function GET(request: Request) {
  if (!(await getSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    q: asOptional(url.searchParams.get("q")),
    status: asOptional(url.searchParams.get("status")),
    hasContent: asOptional(url.searchParams.get("hasContent")),
    from: asOptional(url.searchParams.get("from")),
    to: asOptional(url.searchParams.get("to")),
    sort: asOptional(url.searchParams.get("sort")),
    limit: asOptional(url.searchParams.get("limit")),
    cursor: asOptional(url.searchParams.get("cursor")),
  });

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid inbox query" },
      { status: 400 },
    );
  }

  const from = parsed.data.from ? dateAtStartOfDayUtc(parsed.data.from) : undefined;
  const to = parsed.data.to ? dayAfterUtc(parsed.data.to) : undefined;

  if (from && to && from >= to) {
    return Response.json({ error: "Invalid date range" }, { status: 400 });
  }

  const page = await listThreadPage({
    query: parsed.data.q,
    status: (parsed.data.status ?? "all") as InboxThreadStatus,
    hasContent: Boolean(parsed.data.hasContent),
    from,
    to,
    sort: (parsed.data.sort ?? "newest") as InboxThreadSort,
    limit: clampPageSize(parsed.data.limit),
    cursor: decodeCursor(parsed.data.cursor),
  });

  return Response.json(page);
}


function dateAtStartOfDayUtc(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dayAfterUtc(value: string): Date {
  const next = new Date(`${value}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
