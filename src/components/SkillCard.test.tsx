/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  makePublicPublisher as makePublisher,
  makePublicSkill as makeSkill,
} from "../__tests__/helpers/publicCatalog";
import { SkillCard } from "./SkillCard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("SkillCard", () => {
  it("renders official skills with the compact official mark", () => {
    const { container } = render(
      <SkillCard
        skill={makeSkill()}
        badge="Official"
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders the compact official mark for skills owned by official publishers", () => {
    const { container } = render(
      <SkillCard
        skill={makeSkill()}
        owner={makePublisher({ official: true })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders author topics", () => {
    render(
      <SkillCard
        skill={makeSkill({ topics: ["google-calendar", "productivity"] })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByText("#google-calendar")).toBeTruthy();
    expect(screen.getByText("#productivity")).toBeTruthy();
  });

  it("shows standard-length names in full and previews longer compatibility names", () => {
    const portableName = "S".repeat(64);
    const compatibilityName = "L".repeat(71);
    const { rerender } = render(
      <SkillCard
        skill={makeSkill({ displayName: portableName })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    expect(screen.getByText(portableName)).toBeTruthy();

    rerender(
      <SkillCard
        skill={makeSkill({ displayName: compatibilityName })}
        summaryFallback="Fallback summary"
        meta={<span>meta</span>}
      />,
    );

    const preview = `${"L".repeat(69)}…`;
    expect(screen.getByText(preview).getAttribute("title")).toBe(compatibilityName);
  });
});
