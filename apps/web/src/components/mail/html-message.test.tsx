import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HtmlMessage } from "./html-message";

afterEach(cleanup);

const frameOf = (container: HTMLElement) =>
  container.querySelector("iframe") as HTMLIFrameElement;

/**
 * These assert the containment, not the appearance. Rendering a stranger's
 * markup is the single most dangerous thing this app does, and the guarantees
 * that make it safe are all attributes on one element — exactly the kind of
 * thing a well-meaning refactor removes.
 */
describe("HtmlMessage containment", () => {
  it("never grants allow-scripts", () => {
    // The load-bearing defence. With it, inline handlers, javascript: URLs and
    // <script> all execute with whatever origin the frame has.
    const { container } = render(<HtmlMessage html="<p>hi</p>" />);
    const sandbox = frameOf(container).getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-scripts");
  });

  it("never grants allow-same-origin together with allow-scripts", () => {
    // That pair lets a document remove its own sandbox, which defeats all of
    // this. Either alone is fine; both is not.
    const sandbox =
      frameOf(render(<HtmlMessage html="<p>hi</p>" />).container).getAttribute("sandbox") ?? "";
    const both = sandbox.includes("allow-same-origin") && sandbox.includes("allow-scripts");
    expect(both).toBe(false);
  });

  it("does not grant allow-forms", () => {
    // A form in an email is a credential-harvesting page waiting to post.
    const sandbox =
      frameOf(render(<HtmlMessage html="<p>hi</p>" />).container).getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-forms");
  });

  it("does not grant allow-top-navigation", () => {
    // Otherwise a message can redirect the whole app somewhere else.
    const sandbox =
      frameOf(render(<HtmlMessage html="<p>hi</p>" />).container).getAttribute("sandbox") ?? "";
    expect(sandbox).not.toContain("allow-top-navigation");
  });

  it("locks the document down with a default-src 'none' policy", () => {
    const doc = frameOf(render(<HtmlMessage html="<p>hi</p>" />).container).getAttribute("srcdoc") ?? "";
    expect(doc).toContain("default-src 'none'");
    // Inline styles are the one exception, because email is inline styles.
    expect(doc).toContain("style-src 'unsafe-inline'");
  });

  it("blocks remote images until asked", async () => {
    // A one-pixel image is how a sender learns you opened the message.
    const html = '<p>hi</p><img src="https://tracker.example.com/pixel.gif">';
    const { container } = render(<HtmlMessage html={html} />);

    expect(frameOf(container).getAttribute("srcdoc")).toContain("img-src 'none'");
    expect(screen.getByText(/Images blocked/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /show images/i }));
    expect(frameOf(container).getAttribute("srcdoc")).toContain("img-src data: https: http:");
  });

  it("says nothing about images when there are none to block", () => {
    render(<HtmlMessage html="<p>just text</p>" />);
    expect(screen.queryByText(/Images blocked/i)).toBeNull();
  });

  it("does not treat an inline data: image as remote", () => {
    // Embedded images carry no request, so there is nothing to leak.
    render(<HtmlMessage html='<img src="data:image/png;base64,iVBOR">' />);
    expect(screen.queryByText(/Images blocked/i)).toBeNull();
  });

  it("re-blocks images when a different message is rendered", () => {
    // Showing images is a decision about one message, not a mode.
    const tracked = '<img src="https://a.test/p.gif">';
    const { container, rerender } = render(<HtmlMessage html={tracked} />);
    rerender(<HtmlMessage html='<img src="https://b.test/q.gif">' />);
    expect(frameOf(container).getAttribute("srcdoc")).toContain("img-src 'none'");
  });

  it("sends links to a new tab rather than replacing the app", () => {
    const doc = frameOf(render(<HtmlMessage html="<p>hi</p>" />).container).getAttribute("srcdoc") ?? "";
    expect(doc).toContain('<base target="_blank">');
  });

  it("passes the message HTML through untouched", () => {
    // The iframe is the isolation; the content is not rewritten, so an email
    // is shown as it was authored.
    const html = '<h1 style="color:rebeccapurple">Designed</h1><table><tr><td>x</td></tr></table>';
    const doc = frameOf(render(<HtmlMessage html={html} />).container).getAttribute("srcdoc") ?? "";
    expect(doc).toContain(html);
  });

  it("disables its own scrollbar so the frame is sized to the content", () => {
    // An email in a scrolling box inside a scrolling page is miserable to read.
    const { container } = render(<HtmlMessage html="<p>hi</p>" />);
    expect(frameOf(container).getAttribute("scrolling")).toBe("no");
  });
});
