import { getAuth } from "@sendstack/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The auth instance is built from stored settings, so it cannot be resolved at
 * module load. Each request resolves it — cheap, because `getAuth` returns a
 * cached instance unless the enabled sign-in methods have actually changed.
 */
async function handler(request: Request) {
  const auth = await getAuth();
  const { GET, POST } = toNextJsHandler(auth);
  return request.method === "GET" ? GET(request) : POST(request);
}

export { handler as GET, handler as POST };
