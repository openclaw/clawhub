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
  it("renders banned account guidance with email and appeal next steps", () => {
    render(<AccountBannedPage />);

    expect(
      screen.getByRole("heading", { name: "Your ClawHub account has been banned" }),
    ).toBeTruthy();
    expect(screen.getByText("This account cannot sign in to ClawHub.")).toBeTruthy();
    expect(screen.getByText(/check your email/i)).toBeTruthy();

    const appealLink = screen.getByRole("link", { name: "Open an appeal" });
    expect(appealLink.getAttribute("href")).toBe("https://appeals.openclaw.ai/");
    expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
