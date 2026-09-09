import { getSession } from "@sendstack/auth";
import { z } from "zod";
import { asOptional, clampPageSize, decodeCursor } from "@/lib/cursor";
import { listOutboundPage } from "@/lib/queries/outbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z.enum(["sent", "draft"]),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().optional(),
  cursor: z.string().max(512).optional(),
});

/** One page of sent mail or drafts. See `lib/cursor.ts` for why not offsets. */
export async function GET(request: Request) {
  if (!(await getSession())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    status: url.searchParams.get("status") ?? "sent",
    q: asOptional(url.searchParams.get("q")),
    limit: asOptional(url.searchParams.get("limit")),
    cursor: asOptional(url.searchParams.get("cursor")),
  });

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 },
    );
  }

  const page = await listOutboundPage(parsed.data.status, {
    query: parsed.data.q,
    limit: clampPageSize(parsed.data.limit),
    cursor: decodeCursor(parsed.data.cursor),
  });

  return Response.json(page);
}
