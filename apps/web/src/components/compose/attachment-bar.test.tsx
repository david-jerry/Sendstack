import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const attachFile = vi.fn();
const removeAttachment = vi.fn(async (_id: string) => ({ ok: true }) as const);

vi.mock("@/actions/attachments", () => ({
  attachFile: (body: FormData) => attachFile(body),
  removeAttachment: (id: string) => removeAttachment(id),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";
import type { AttachedFile } from "@/actions/attachments";
import { AttachmentBar } from "./attachment-bar";

afterEach(cleanup);
beforeEach(() => {
  attachFile.mockReset();
  removeAttachment.mockClear();
});

const file = (name: string) => new File(["hello"], name, { type: "text/plain" });

const stored = (id: string, filename: string): AttachedFile => ({
  id,
  filename,
  contentType: "text/plain",
  byteSize: 5,
  disposition: "attachment",
  url: `/api/attachments/${id}`,
});

/** Holds the state the composer would hold, so the bar behaves as it ships. */
function Harness({ draftId = null }: { draftId?: string | null }) {
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [id, setId] = useState<string | null>(draftId);
  return (
    <>
      <AttachmentBar
        draftId={id}
        files={files}
        onChange={setFiles}
        onDraftCreated={setId}
      />
      <span data-testid="draft">{id ?? "none"}</span>
    </>
  );
}

const input = (container: HTMLElement) =>
  container.querySelector("input[type=file]") as HTMLInputElement;

describe("AttachmentBar", () => {
  it("uploads several files one at a time, against one draft", async () => {
    const user = userEvent.setup({ delay: null });
    attachFile
      .mockResolvedValueOnce({ ok: true, draftId: "draft-1", file: stored("a", "one.txt") })
      .mockResolvedValueOnce({ ok: true, draftId: "draft-1", file: stored("b", "two.txt") });

    const { container } = render(<Harness />);
    await user.upload(input(container), [file("one.txt"), file("two.txt")]);

    await waitFor(() => expect(screen.getByText("two.txt")).toBeInTheDocument());
    expect(screen.getByText("one.txt")).toBeInTheDocument();

    // The first upload created the draft; the second must have been told about
    // it, or two files chosen together would land on two different drafts.
    expect(attachFile).toHaveBeenCalledTimes(2);
    expect(attachFile.mock.calls[0]![0].get("draftId")).toBeNull();
    expect(attachFile.mock.calls[1]![0].get("draftId")).toBe("draft-1");
    expect(screen.getByTestId("draft")).toHaveTextContent("draft-1");
  });

  it("reports a rejected file and keeps the rest", async () => {
    const user = userEvent.setup({ delay: null });
    attachFile
      .mockResolvedValueOnce({ ok: false, error: "too big" })
      .mockResolvedValueOnce({ ok: true, draftId: "draft-1", file: stored("b", "two.txt") });

    const { container } = render(<Harness />);
    await user.upload(input(container), [file("one.txt"), file("two.txt")]);

    await waitFor(() => expect(screen.getByText("two.txt")).toBeInTheDocument());
    expect(toast.error).toHaveBeenCalledWith("too big");
    expect(screen.queryByText("one.txt")).toBeNull();
  });

  it("removes a file", async () => {
    const user = userEvent.setup({ delay: null });
    attachFile.mockResolvedValueOnce({
      ok: true,
      draftId: "draft-1",
      file: stored("a", "one.txt"),
    });

    const { container } = render(<Harness />);
    await user.upload(input(container), file("one.txt"));
    await waitFor(() => expect(screen.getByText("one.txt")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /remove one.txt/i }));

    await waitFor(() => expect(screen.queryByText("one.txt")).toBeNull());
    expect(removeAttachment).toHaveBeenCalledWith("a");
  });
});
