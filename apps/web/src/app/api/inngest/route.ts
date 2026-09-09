import { serve } from "inngest/next";
import { applyInngestConfig, functions, inngest } from "@sendstack/jobs";

const handler = serve({ client: inngest, functions });

/**
 * Inngest keys live in the settings table, so they are pushed into the client
 * per request rather than read from the environment at import.
 *
 * Deliberately *not* a top-level `await`: module scope is evaluated during
 * `next build` while collecting route configuration, long before any database
 * exists. An await there turns a first-time build into a connection error.
 */
type RouteHandler = (typeof handler)["GET"];

function withConfig(run: RouteHandler): RouteHandler {
  return (async (...args: Parameters<RouteHandler>) => {
    await applyInngestConfig();
    return run(...args);
  }) as RouteHandler;
}

export const GET = withConfig(handler.GET);
export const POST = withConfig(handler.POST);
export const PUT = withConfig(handler.PUT);

// The send loop and the inbound fetch both talk to Postgres and Resend, so
// this route needs the Node runtime rather than the edge one.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
