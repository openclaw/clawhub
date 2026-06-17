/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: unknown }) => config,
}));

vi.mock("../../components/layout/Container", () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
}));

const { CliAuth } = await import("./auth");

describe("CliAuth", () => {
  it("does not mint callback tokens from legacy browser login links", () => {
    render(<CliAuth />);

    expect(screen.getByRole("heading", { name: /CLI login has moved/i })).toBeTruthy();
    expect(screen.getByText(/device-code login/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Create token/i })).toBeNull();
  });
});
