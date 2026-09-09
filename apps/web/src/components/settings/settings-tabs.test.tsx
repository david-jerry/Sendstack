import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPanel, SettingsTabs, type SettingsTab } from "./settings-tabs";

const TABS: SettingsTab[] = [
  { id: "workspace", label: "Workspace", hint: "Name and logo" },
  { id: "email", label: "Email", hint: "Resend and sender" },
  { id: "deliverability", label: "Deliverability", hint: "Reaching an inbox", badge: 4 },
];

function renderTabs(initial = "workspace") {
  return render(
    <SettingsTabs tabs={TABS} initial={initial}>
      <SettingsPanel value="workspace">
        <label htmlFor="name">Workspace name</label>
        <input id="name" defaultValue="" />
      </SettingsPanel>
      <SettingsPanel value="email">
        <p>Resend settings</p>
      </SettingsPanel>
      <SettingsPanel value="deliverability">
        <p>Deliverability report</p>
      </SettingsPanel>
    </SettingsTabs>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, "", "/settings");
});

afterEach(cleanup);

describe("SettingsTabs", () => {
  it("opens on the tab the server resolved", () => {
    // The initial tab comes from `?tab=` so the first paint is already right —
    // a client-side default would flash the wrong panel on every deep link.
    renderTabs("email");
    expect(screen.getByRole("tab", { name: "Email" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switches panels without leaving the page", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole("tab", { name: /Deliverability/ }));

    expect(screen.getByRole("tab", { name: /Deliverability/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Deliverability report")).toBeVisible();
  });

  it("writes the tab into the URL so it can be linked and reloaded", async () => {
    const user = userEvent.setup();
    renderTabs();

    await user.click(screen.getByRole("tab", { name: "Email" }));
    expect(window.location.search).toBe("?tab=email");
  });

  it("replaces rather than pushes, so Back leaves Settings", async () => {
    // Pushing an entry per tab would mean six presses of Back to get out of a
    // page someone was only looking around.
    const user = userEvent.setup();
    renderTabs();
    const before = window.history.length;

    await user.click(screen.getByRole("tab", { name: "Email" }));
    await user.click(screen.getByRole("tab", { name: /Deliverability/ }));

    expect(window.history.length).toBe(before);
  });

  it("keeps hidden panels mounted, so half-typed input survives a look around", async () => {
    // Radix unmounts inactive content by default. On a page of forms with
    // their own Save buttons, that silently discards work.
    const user = userEvent.setup();
    renderTabs();

    await user.type(screen.getByLabelText("Workspace name"), "Acme");
    await user.click(screen.getByRole("tab", { name: "Email" }));
    await user.click(screen.getByRole("tab", { name: "Workspace" }));

    expect(screen.getByLabelText("Workspace name")).toHaveValue("Acme");
  });

  it("hides the panels that are not selected", async () => {
    renderTabs();
    // Mounted is not the same as visible — `forceMount` would otherwise show
    // every section at once.
    expect(screen.getByText("Resend settings")).not.toBeVisible();
  });

  it("shows a count only where there is something to count", () => {
    renderTabs();
    expect(screen.getByRole("tab", { name: /Deliverability/ })).toHaveTextContent("4");
    expect(screen.getByRole("tab", { name: "Workspace" })).not.toHaveTextContent(/\d/);
  });

  it("labels the rail for assistive tech", () => {
    renderTabs();
    expect(screen.getByRole("tablist", { name: "Settings sections" })).toBeInTheDocument();
  });
});
