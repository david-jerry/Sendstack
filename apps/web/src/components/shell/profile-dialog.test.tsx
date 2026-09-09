import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("@sendstack/auth/client", () => ({
  authClient: { passkey: { addPasskey: vi.fn(async () => ({ data: {}, error: null })) } },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const listActiveSessions = vi.fn();
const revokeSession = vi.fn(async (_id: string) => ({ ok: true as const }));
const revokeOtherSessions = vi.fn(async () => ({ ok: true as const }));

vi.mock("@/actions/profile", () => ({
  listActiveSessions: () => listActiveSessions(),
  revokeSession: (id: string) => revokeSession(id),
  revokeOtherSessions: () => revokeOtherSessions(),
  uploadAvatar: vi.fn(async () => ({ ok: true })),
  removeAvatar: vi.fn(async () => ({ ok: true })),
  updateDisplayName: vi.fn(async () => ({ ok: true })),
}));

import { ProfileDialog } from "./profile-dialog";

const USER = { name: "Ada", email: "ada@example.com", image: null , emailVerified: true };

const HERE = {
  id: "here",
  device: "Chrome on macOS",
  ipAddress: "203.0.113.7",
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-06T09:00:00.000Z",
  expiresAt: "2026-10-06T09:00:00.000Z",
  current: true,
};

const PHONE = {
  ...HERE,
  id: "phone",
  device: "Safari on iPhone",
  ipAddress: "198.51.100.4",
  current: false,
};

function open(sessions = [HERE, PHONE]) {
  listActiveSessions.mockResolvedValue(sessions);
  return render(
    <ProfileDialog
      user={USER}
      open
      onOpenChange={() => {}}
      onSignOut={() => {}}
      signingOut={false}
    />,
  );
}

const row = (name: RegExp) => screen.getByText(name).closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("ProfileDialog", () => {
  it("opens on Profile, and does not fetch sessions until asked", async () => {
    open();
    expect(screen.getByText("Profile picture")).toBeInTheDocument();
    // The list is a database round trip most visits never need.
    expect(listActiveSessions).not.toHaveBeenCalled();
  });

  it("lists active sessions and marks the one you are on", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("tab", { name: "Sessions" }));

    await screen.findByText("Chrome on macOS");
    expect(screen.getByText("Safari on iPhone")).toBeInTheDocument();
    expect(within(row(/Chrome on macOS/)).getByText("This device")).toBeInTheDocument();
  });

  it("offers no way to end the session you are using", async () => {
    // Revoking your own session from a list is indistinguishable from the app
    // logging you out at random. Sign out is the control for that.
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("tab", { name: "Sessions" }));
    await screen.findByText("Chrome on macOS");

    expect(within(row(/Chrome on macOS/)).queryByRole("button", { name: "End" })).toBeNull();
    expect(within(row(/Safari on iPhone/)).getByRole("button", { name: "End" })).toBeInTheDocument();
  });

  it("ends another session and reloads the list", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("tab", { name: "Sessions" }));
    await screen.findByText("Safari on iPhone");

    listActiveSessions.mockResolvedValue([HERE]);
    await user.click(within(row(/Safari on iPhone/)).getByRole("button", { name: "End" }));

    expect(revokeSession).toHaveBeenCalledWith("phone");
    // A list that still shows the device you just signed out is worse than no
    // list at all, so the reload is part of the action rather than a refresh
    // the user has to think to ask for.
    await waitFor(() => expect(screen.queryByText("Safari on iPhone")).toBeNull());
  });

  it("offers a single control for everywhere else", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("tab", { name: "Sessions" }));
    const endAll = await screen.findByRole("button", { name: /End the other session/ });

    listActiveSessions.mockResolvedValue([HERE]);
    await user.click(endAll);

    expect(revokeOtherSessions).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/only device signed in/)).toBeInTheDocument(),
    );
  });

  it("says so when the list cannot be loaded", async () => {
    const user = userEvent.setup();
    listActiveSessions.mockRejectedValue(new Error("UNAUTHORIZED"));
    render(
      <ProfileDialog
        user={USER}
        open
        onOpenChange={() => {}}
        onSignOut={() => {}}
        signingOut={false}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(await screen.findByText("Could not load your sessions.")).toBeInTheDocument();
  });

  it("keeps the passkey form reachable beside the rest", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("tab", { name: "Passkeys" }));
    expect(screen.getByRole("button", { name: /Register passkey/ })).toBeInTheDocument();
  });
});
