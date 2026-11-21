/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import {
  makePublicPublisher as makePublisher,
  makePublicSkill,
} from "../__tests__/helpers/publicCatalog";
import * as analytics from "../lib/analyticsEvents";
import type { PublicSkill } from "../lib/publicUser";
import { SkillListItem } from "./SkillListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    onClick,
  }: {
    children?: ReactNode;
    to?: string;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={to}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

describe("SkillListItem", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps explicit catalog links separate from the skill analytics identity", () => {
    const emit = vi.spyOn(analytics, "emitAnalytics").mockReturnValue(true);
    render(<SkillListItem skill={makeSkill()} href="/publisher/catalog-slug" />);

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/publisher/catalog-slug");
    fireEvent.click(link);
    expect(emit).toHaveBeenCalledWith("select_content", {
      content_type: "skill",
      content_id: "skill:skills:demo",
      ui_location: "catalog",
    });
  });

  it.each([
    { handle: " explicit owner ", publisher: "publisher", expected: "explicit%20owner" },
    { handle: undefined, publisher: " publisher owner ", expected: "publisher%20owner" },
    { handle: " ", publisher: "publisher", expected: "publishers%3Aowner" },
  ])("preserves route owner precedence for $expected", ({ handle, publisher, expected }) => {
    render(
      <SkillListItem
        skill={makeSkill({ slug: "some skill" })}
        ownerHandle={handle}
        owner={makePublisher({ handle: publisher })}
      />,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe(`/${expected}/some%20skill`);
  });

  it("falls back to the user identity when no publisher identity is present", () => {
    render(<SkillListItem skill={makeSkill({ ownerPublisherId: undefined })} />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/users%3Aowner/demo");
  });

  it.each([true, false])("uses inferred taxonomy only for its matching version: %s", (current) => {
    const { container } = render(
      <SkillListItem
        skill={makeSkill({
          categories: undefined,
          inferredCategories: ["development"],
          latestVersionId: "skillVersions:latest" as Id<"skillVersions">,
          inferredFromVersionId: (current
            ? "skillVersions:latest"
            : "skillVersions:old") as Id<"skillVersions">,
        })}
      />,
    );
    expect(screen.queryByText("Development") !== null).toBe(current);
    expect(container.querySelector(".lucide-wrench") !== null).toBe(current);
    expect(container.querySelector(".lucide-slash") !== null).toBe(!current);
  });

  it("retains the official mark and deprecated badge when both are present", () => {
    const { container } = render(
      <SkillListItem
        skill={makeSkill({
          badges: {
            official: { byUserId: "users:admin" as Id<"users">, at: 1 },
            deprecated: { byUserId: "users:admin" as Id<"users">, at: 2 },
          },
        })}
      />,
    );
    const official = screen.getByLabelText("Official");
    const deprecated = screen.getByText("Deprecated");
    expect(
      official.compareDocumentPosition(deprecated) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelectorAll(".official-badge")).toHaveLength(1);
  });

  it("renders official skills with the compact official mark", () => {
    const { container } = render(
      <SkillListItem
        skill={makeSkill({
          badges: {
            official: {
              byUserId: "users:admin" as Id<"users">,
              at: 1,
            },
          },
        })}
        ownerHandle="local"
      />,
    );

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders the compact official mark for skills owned by official publishers", () => {
    const { container } = render(
      <SkillListItem skill={makeSkill()} owner={makePublisher({ official: true })} />,
    );

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });

  it("renders up to two author topics in browse rows", () => {
    render(<SkillListItem skill={makeSkill({ topics: ["discord", "community", "automation"] })} />);

    expect(screen.getByText("#discord")).toBeTruthy();
    expect(screen.getByText("#community")).toBeTruthy();
    expect(screen.queryByText("#automation")).toBeNull();
  });

  it("keeps the creator inline without a second avatar", () => {
    const { container } = render(<SkillListItem skill={makeSkill()} ownerHandle="creator" />);

    expect(screen.getByText("@creator")).toBeTruthy();
    expect(container.querySelector(".skill-list-item-main img")).toBeNull();
    expect(container.querySelector(".lucide-bookmark")).toBeTruthy();
    expect(container.querySelector(".lucide-star")).toBeNull();
  });

  it("previews long names without displacing the creator identity", () => {
    const displayName = "L".repeat(71);
    const { container } = render(
      <SkillListItem skill={makeSkill({ displayName })} ownerHandle="creator" />,
    );

    const identity = container.querySelector(".skill-list-item-identity");
    const name = identity?.querySelector(".skill-list-item-name");
    expect(name?.textContent).toBe(`${"L".repeat(69)}…`);
    expect(name?.getAttribute("title")).toBe(displayName);
    expect(identity?.querySelector(".skill-list-item-owner")?.textContent).toBe("@creator");
  });
});

function makeSkill(overrides: Partial<PublicSkill> = {}): PublicSkill {
  return makePublicSkill({
    stats: {
      downloads: 9,
      stars: 2,
      versions: 1,
      comments: 0,
      installs: 0,
    },
    ...overrides,
  });
}
