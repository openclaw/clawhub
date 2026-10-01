/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { HomeBringSkillsSection } from "../components/HomeBringSkillsSection";

describe("HomeBringSkillsSection", () => {
  it("does not advertise the removed sync command", () => {
    render(<HomeBringSkillsSection />);

    expect(screen.queryByText("clawhub sync --all")).toBeNull();
    expect(screen.getByText(/clawhub skill publish/)).toBeTruthy();
  });
});
