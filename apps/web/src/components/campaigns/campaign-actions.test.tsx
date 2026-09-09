import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const sendCampaignNow = vi.fn(async (_id: string) => ({ ok: true }) as const);
const pauseCampaign = vi.fn(async (_id: string) => ({ ok: true }) as const);
const resumeCampaign = vi.fn(async (_id: string) => ({ ok: true }) as const);
const cancelCampaignAction = vi.fn(async (_id: string) => ({ ok: true }) as const);
const scheduleCampaign = vi.fn(async (_input: unknown) => ({ ok: true }) as const);
const refresh = vi.fn();

vi.mock("@/actions/campaigns", () => ({
  sendCampaignNow: (id: string) => sendCampaignNow(id),
  pauseCampaign: (id: string) => pauseCampaign(id),
  resumeCampaign: (id: string) => resumeCampaign(id),
  cancelCampaignAction: (id: string) => cancelCampaignAction(id),
  scheduleCampaign: (input: unknown) => scheduleCampaign(input),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { CampaignActions } from "./campaign-actions";

afterEach(cleanup);
beforeEach(() => {
  sendCampaignNow.mockClear();
  cancelCampaignAction.mockClear();
});

const typist = () => userEvent.setup({ delay: null });

describe("CampaignActions", () => {
  it("asks before sending, and says how many it would reach", async () => {
    const user = typist();
    render(<CampaignActions campaignId="c1" status="draft" recipients={4210} />);

    await user.click(screen.getByRole("button", { name: /send now/i }));

    // The one action here that cannot be undone once the provider has the
    // batch, so it does not happen on a single click.
    expect(sendCampaignNow).not.toHaveBeenCalled();
    expect(screen.getByText(/4210 contacts\?/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /yes, send it/i }));
    await waitFor(() => expect(sendCampaignNow).toHaveBeenCalledWith("c1"));
  });

  it("lets the confirmation be backed out of", async () => {
    const user = typist();
    render(<CampaignActions campaignId="c1" status="draft" recipients={10} />);

    await user.click(screen.getByRole("button", { name: /send now/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(sendCampaignNow).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /send now/i })).toBeInTheDocument();
  });

  it("offers pause while sending and resume while paused", () => {
    const { unmount } = render(
      <CampaignActions campaignId="c1" status="sending" recipients={10} />,
    );
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    unmount();

    render(<CampaignActions campaignId="c1" status="paused" recipients={10} />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
  });

  it("offers nothing once a campaign is finished", () => {
    const { container } = render(
      <CampaignActions campaignId="c1" status="sent" recipients={10} />,
    );
    // Not a disabled button — a sent campaign cannot be sent again, and a
    // greyed "Send" invites the click that asks why not.
    expect(container).toBeEmptyDOMElement();
  });
});
