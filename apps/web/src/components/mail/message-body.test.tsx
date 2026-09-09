import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageBody, looksLikeMarkup } from "./message-body";

afterEach(cleanup);

const typist = () => userEvent.setup({ delay: null });
const frame = (container: HTMLElement) => container.querySelector("iframe");

describe("MessageBody", () => {
  it("shows the formatted message first when both parts exist", () => {
    const { container } = render(
      <MessageBody html="<p>Designed</p>" text="Designed" />,
    );

    // The designed version is the message; the text alternative is a fallback,
    // and opening on it hides the layout the sender actually wrote.
    expect(frame(container)).not.toBeNull();
    expect(screen.getByRole("button")).toHaveTextContent("View plain text");
  });

  it("switches to the text part and back", async () => {
    const user = typist();
    const { container } = render(
      <MessageBody html="<p>Designed</p>" text="The plain words" />,
    );

    await user.click(screen.getByRole("button", { name: /view plain text/i }));
    expect(frame(container)).toBeNull();
    expect(screen.getByText("The plain words")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /view formatted message/i }));
    expect(frame(container)).not.toBeNull();
  });

  it("offers no toggle when there is only one part", () => {
    const { container: htmlOnly } = render(<MessageBody html="<p>Hi</p>" text={null} />);
    expect(frame(htmlOnly)).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    cleanup();

    render(<MessageBody html={null} text="Just words" />);
    expect(screen.getByText("Just words")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ignores a text part that is really markup", () => {
    // Some senders put the HTML body in both MIME parts. Rendering that as
    // text is what fills a preview with visible tags.
    const html = "<p>Hello</p>";
    const { container } = render(<MessageBody html={html} text={html} />);

    expect(frame(container)).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/<p>/)).toBeNull();
  });

  it("says so when there is nothing to show", () => {
    render(<MessageBody html={null} text="   " empty="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
  });
});

describe("looksLikeMarkup", () => {
  it("recognises documents, tags and closing tags", () => {
    expect(looksLikeMarkup("<!DOCTYPE html><html><body>hi</body></html>")).toBe(true);
    expect(looksLikeMarkup("<p>hello</p>")).toBe(true);
    expect(looksLikeMarkup("<br/>")).toBe(true);
  });

  it("does not mistake ordinary prose for markup", () => {
    // Quoted replies and comparisons are full of angle brackets that are not
    // tags, and treating them as markup would hide a message's only content.
    expect(looksLikeMarkup("> quoted reply text")).toBe(false);
    expect(looksLikeMarkup("if a < b and b > c then")).toBe(false);
    expect(looksLikeMarkup("mail me at <ada@example.com>")).toBe(false);
  });
});
