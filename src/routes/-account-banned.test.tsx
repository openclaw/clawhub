/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountBannedPage } from "./account-banned";

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    createFileRoute: () => (config: unknown) => config,
  };
});

describe("AccountBannedPage", () => {
  it("renders appeal-only banned account guidance", () => {
    render(<AccountBannedPage />);

    expect(
      screen.getByRole("heading", { name: "Your ClawHub account has been banned" }),
    ).toBeTruthy();
    expect(screen.getByText("This account cannot sign in to ClawHub.")).toBeTruthy();

    const appealLink = screen.getByRole("link", { name: "Open an appeal" });
    expect(appealLink.getAttribute("href")).toBe("https://appeals.openclaw.ai/");
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
