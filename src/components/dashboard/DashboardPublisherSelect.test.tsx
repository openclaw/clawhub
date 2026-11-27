/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { describe, expect, it, vi } from "vitest";
import { DashboardHeader } from "./DashboardHeader";
import { DashboardPublisherSelect } from "./DashboardPublisherSelect";
import type { DashboardPublisherEntry } from "./types";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    to: string;
    search: Record<string, string | undefined>;
  }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined) params.set(key, value);
    }
    return <a href={`${to}?${params}`} {...props} />;
  },
}));

const publishers: DashboardPublisherEntry[] = [
  {
    publisher: {
      _id: "personal",
      handle: "local",
      displayName: "Personal Publisher",
      kind: "user",
      image: "https://example.invalid/avatar.png",
    },
    role: "owner",
  },
  {
    publisher: { _id: "organization", handle: "team", displayName: "", kind: "org" },
    role: "admin",
  },
];

describe("dashboard publisher selection", () => {
  it("renders the controlled publisher with its image or organization fallback", () => {
    const props = { publishers, onValueChange: vi.fn() };
    const view = render(<DashboardPublisherSelect {...props} value="personal" />);
    const trigger = screen.getByRole("combobox", { name: "Dashboard publisher" });
    expect(trigger.textContent).toBe("Personal Publisher");
    expect(trigger.querySelector(".marketplace-icon-user img")?.getAttribute("src")).toBe(
      "https://example.invalid/avatar.png",
    );

    view.rerender(<DashboardPublisherSelect {...props} value="organization" />);
    expect(trigger.textContent).toBe("team");
    expect(trigger.querySelector(".marketplace-icon-org")).not.toBeNull();
  });

  it("keeps the placeholder when no publisher is selected", () => {
    render(<DashboardPublisherSelect publishers={publishers} value="" onValueChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Dashboard publisher" }).textContent).toBe(
      "Select publisher",
    );
  });

  it("keeps the header's compact publisher control and selected-owner Add link", () => {
    render(
      <DashboardHeader
        publishers={publishers}
        activePublisherId="organization"
        onPublisherChange={vi.fn()}
        ownerHandle="team"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Dashboard publisher" });
    expect(trigger.textContent).toBe("team");
    expect(trigger.getAttribute("data-size")).toBe("sm");
    expect(trigger.classList.contains("dashboard-welcome-publisher-trigger")).toBe(true);
    expect(trigger.querySelector(".lucide-chevrons-up-down")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Add skill or plugin" }).getAttribute("href")).toBe(
      "/add?kind=skill&ownerHandle=team",
    );
  });

  it("does not offer switching when the header has only one publisher", () => {
    render(
      <DashboardHeader
        publishers={[publishers[0]!]}
        activePublisherId="personal"
        onPublisherChange={vi.fn()}
        ownerHandle="local"
      />,
    );
    expect(screen.queryByRole("combobox", { name: "Dashboard publisher" })).toBeNull();
    expect(screen.getByRole("link", { name: "Add skill or plugin" }).getAttribute("href")).toBe(
      "/add?kind=skill&ownerHandle=local",
    );
  });
});
