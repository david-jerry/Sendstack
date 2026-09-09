"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageOff, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Renders an email's HTML — someone else's markup — without handing it the app.
 *
 * The rules this is built around, in the order they matter:
 *
 *  1. **No scripts, ever.** The `sandbox` attribute omits `allow-scripts`, so
 *     nothing executes: not inline handlers, not `javascript:` URLs, not
 *     `<script>`. This is the load-bearing defence and everything else is
 *     depth behind it.
 *  2. **`allow-same-origin` is present, and that is safe here** *only* because
 *     `allow-scripts` is absent. Same-origin without scripts grants the
 *     document nothing — there is no code to read a cookie with. It buys the
 *     one thing a fully opaque frame cannot give: the parent can measure the
 *     content and size the frame to it. The pairing to never write is
 *     `allow-same-origin allow-scripts`, which lets a document remove its own
 *     sandbox.
 *  3. **A CSP inside the document** blocks everything by default and permits
 *     only inline styles, which email genuinely needs. It is what actually
 *     stops remote images, so toggling them needs no rewriting of the HTML.
 *  4. **Remote images are blocked until asked for.** A one-pixel image is how
 *     senders learn you opened a message, when, and roughly where from. Every
 *     serious mail client blocks them by default and so does this.
 *  5. **Links open in a new tab** via `<base target="_blank">`; the sandbox
 *     withholds `allow-top-navigation`, so nothing can redirect the app.
 */
function buildDocument(html: string, showImages: boolean): string {
  const csp = [
    "default-src 'none'",
    // Email is inline styles almost by definition; without this nothing renders.
    "style-src 'unsafe-inline'",
    showImages ? "img-src data: https: http:" : "img-src 'none'",
    "font-src data:",
  ].join("; ");

  return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  /* A neutral page, close to what a mail client provides. Emails are almost
     universally authored against a white ground, so rendering them on one is
     showing the message as designed rather than as reinterpreted. */
  html, body { margin: 0; padding: 0; background: #ffffff; color: #18181b; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.5;
    padding: 14px 16px;
    /* Wide tables and fixed-width layouts are the norm in email; contain them
       rather than letting them force a horizontal scrollbar on the app. */
    overflow-wrap: break-word;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  a { color: #1d4ed8; }
  blockquote {
    margin: 0 0 0 8px; padding-left: 10px;
    border-left: 2px solid #e4e4e7; color: #52525b;
  }
</style>
</head><body>${html}</body></html>`;
}

export function HtmlMessage({ html, className }: { html: string; className?: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [showImages, setShowImages] = useState(false);

  /**
   * Pure derivations, not state. Whether the message has a remote image is a
   * fact about the HTML, and re-blocking images when a different message is
   * rendered is an adjustment React supports doing during render — an effect
   * for either would set state after paint and flash the wrong thing first.
   */
  const hasRemoteImages = /<img[^>]+src=["']?https?:/i.test(html);
  const [renderedHtml, setRenderedHtml] = useState(html);
  if (renderedHtml !== html) {
    setRenderedHtml(html);
    setShowImages(false);
  }

  /**
   * Size the frame to its content, so the email is shown whole rather than in
   * a scrolling box inside a scrolling page. Re-measured on load and whenever
   * the content reflows — images arriving after a toggle change the height.
   */
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    const next = Math.max(
      doc.body.scrollHeight,
      doc.documentElement?.scrollHeight ?? 0,
    );
    if (next > 0) setHeight(next);
  }, []);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc?.documentElement) return;

    const observer = new ResizeObserver(() => measure());
    observer.observe(doc.documentElement);
    return () => observer.disconnect();
  }, [measure, showImages, html]);

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-white", className)}>
      {hasRemoteImages && !showImages ? (
        <div className="flex items-center gap-2 border-b bg-secondary/60 px-3 py-1.5">
          <ImageOff className="size-3.5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-muted-foreground">
            Images blocked — loading them tells the sender you opened this.
          </p>
          <button
            type="button"
            onClick={() => setShowImages(true)}
            className="shrink-0 rounded border bg-card px-1.5 py-0.5 text-[11px] font-medium hover:bg-accent"
          >
            Show images
          </button>
        </div>
      ) : null}

      <iframe
        ref={frame}
        title="Message content"
        // No allow-scripts, no allow-forms. See the note above on why
        // allow-same-origin is safe in that company and necessary here.
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={buildDocument(html, showImages)}
        onLoad={measure}
        style={{ height }}
        className="w-full border-0 bg-white"
        scrolling="no"
      />
    </div>
  );
}

/** Opens the message full-screen, for a layout the panel is too narrow for. */
export function ExpandHtml({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open full width"
      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <Maximize2 className="size-3" />
    </button>
  );
}
