import { getSession } from "@sendstack/auth";
import { customTemplateHtml, renderTemplatePreview } from "@sendstack/email";
import { parseTemplateRef } from "@sendstack/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Renders a design with placeholder copy, for the settings grid and the
 * Design picker.
 *
 * `getSession` and an explicit 401, not `requireSession` — that helper throws,
 * which is right inside a Server Action (an unchecked result becomes a crash
 * rather than a silent authorisation bypass) but wrong here, where it would
 * surface as a 500 and leave a client unable to tell "not signed in" from
 * "server broken".
 *
 * The pickers show these inside sandboxed iframes rather than inlining the
 * markup: an email template is a full document with its own body styles, and
 * dropping several of them into the settings page would have them fight the
 * app's own stylesheet. An iframe gives each the isolated document it expects
 * — which is also, usefully, exactly what a mail client gives it. For an
 * uploaded template the sandbox is also the security boundary: the HTML was
 * written by an operator, but the preview runs in the operator's own browser
 * with the operator's own session, and `sandbox=""` plus the CSP header below
 * mean it can run nothing and reach nothing.
 */
export async function GET(request: Request) {
  if (!(await getSession())) return new Response("Unauthorized", { status: 401 });

  // Narrowed against the shared parser rather than cast: this value comes off
  // a query string and is about to select a component or a database row.
  const ref = parseTemplateRef(new URL(request.url).searchParams.get("template"));
  if (!ref) return new Response("Unknown template", { status: 400 });

  let html: string;
  if ("kind" in ref) {
    html = await renderTemplatePreview(ref.kind);
  } else {
    const stored = await customTemplateHtml(ref.customId);
    if (!stored) return new Response("Template not found", { status: 404 });
    html = await renderTemplatePreview({ html: stored });
  }

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // Belt and braces alongside the iframe's sandbox attribute.
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
