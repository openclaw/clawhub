import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { SkillCard } from "./SkillCard";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const skill = {
  _id: "skills:1" as Id<"skills">,
  _creationTime: 0,
  slug: "weather",
  displayName: "Weather",
  summary: "Get current weather.",
  ownerUserId: "users:1" as Id<"users">,
  ownerPublisherId: "publishers:weather" as Id<"publishers">,
  canonicalSkillId: undefined,
  forkOf: undefined,
  latestVersionId: undefined,
  tags: {},
  badges: {},
  stats: {
    downloads: 1,
    installsCurrent: 1,
    installsAllTime: 1,
    stars: 1,
    versions: 1,
    comments: 0,
  },
  createdAt: 0,
  updatedAt: 0,
};

describe("SkillCard publisher trust badges", () => {
  it("renders both badges when the owner is verified and trusted", () => {
    render(
      <SkillCard
        skill={skill}
        trustedPublisher
        verifiedPublisher
        summaryFallback="Fallback summary"
        meta={<div>meta</div>}
      />,
    );

    expect(screen.getByText("Verified publisher")).toBeTruthy();
    expect(screen.getByText("Trusted publisher")).toBeTruthy();
  });

  it("omits both badges for untrusted and unverified owners", () => {
    render(<SkillCard skill={skill} summaryFallback="Fallback summary" meta={<div>meta</div>} />);

    expect(screen.queryByText("Verified publisher")).toBeNull();
    expect(screen.queryByText("Trusted publisher")).toBeNull();
  });
});
