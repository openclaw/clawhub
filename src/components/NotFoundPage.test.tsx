/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { NotFoundPage } from "./NotFoundPage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

describe("NotFoundPage", () => {
  it("renders a single recovery action back to the homepage", () => {
    render(<NotFoundPage />);

    expect(screen.getByText("404 • Page not found")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Return home" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText("Lost route")).toBeNull();
    expect(screen.queryByText("Try next")).toBeNull();
    expect(screen.queryByRole("link", { name: /Browse / })).toBeNull();
  });
});
