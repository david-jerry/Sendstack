"use client";

import { useEffect } from "react";

/**
 * The last boundary: the root layout itself threw.
 *
 * Three constraints make this file unlike every other screen, and all three
 * are the reason it does not use the shared `Failure` component:
 *
 *  1. **It replaces the root layout**, so it has to render its own `<html>`
 *     and `<body>`. Next mounts nothing above it.
 *  2. **The stylesheet may never have loaded.** `globals.css` is imported by
 *     the layout that just failed, so Tailwind classes cannot be relied on —
 *     hence inline styles, which is the one place in this codebase where that
 *     is the correct choice rather than a shortcut.
 *  3. **The theme provider is gone**, so there is no `.dark` class to key off.
 *     `color-scheme` plus `prefers-color-scheme` is what is left, and it is
 *     enough to avoid a white flash on a dark setup.
 *
 * If this screen is ever seen, something is wrong with the layout, the fonts,
 * the theme provider or the database call inside `generateMetadata` — so it
 * offers a reload rather than a retry. `reset()` would re-run the same layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error] root layout", { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <html lang="en" style={{ colorScheme: "light dark" }}>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          fontSize: 14,
          lineHeight: 1.55,
          background: "Canvas",
          color: "CanvasText",
        }}
      >
        <div role="alert" style={{ maxWidth: 380, textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Sendstack could not start</h1>
          <p style={{ margin: "8px 0 0", opacity: 0.7 }}>
            The application shell failed to load, so none of the usual screens are available.
            This is normally a configuration problem — most often a database that cannot be
            reached.
          </p>

          {error.digest ? (
            <p
              style={{
                margin: "12px 0 0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                opacity: 0.6,
                wordBreak: "break-word",
              }}
            >
              Reference {error.digest}
            </p>
          ) : null}

          <div
            style={{
              marginTop: 20,
              display: "flex",
              gap: 8,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            {/*
              * A full reload, not `reset()`.
              *
              * `reset()` re-renders the same root layout that just threw; if
              * the cause is its own data or an import, it will throw again
              * immediately and the button will look broken.
              */}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid CanvasText",
                background: "CanvasText",
                color: "Canvas",
                font: "inherit",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Reload
            </button>
            <a
              href="/setup"
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 6,
                border: "1px solid",
                borderColor: "color-mix(in srgb, CanvasText 25%, transparent)",
                color: "inherit",
                textDecoration: "none",
                font: "inherit",
                fontWeight: 500,
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              Check setup
            </a>
          </div>
        </div>
        {/* `reset` is part of the contract Next passes in; referenced so the
            unused-argument lint does not ask for it to be dropped. */}
        <span hidden data-reset={typeof reset} />
      </body>
    </html>
  );
}
