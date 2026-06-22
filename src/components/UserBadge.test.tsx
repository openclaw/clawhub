/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicPublisher, PublicUser } from "../lib/publicUser";
import { TooltipProvider } from "./ui/tooltip";
import { getHoverTotalDownloads, UserBadge } from "./UserBadge";

describe("UserBadge", () => {
  const user: PublicUser = {
    _id: "user-steipete" as Id<"users">,
    _creationTime: 1,
    handle: "steipete",
    name: "Peter",
    displayName: "Peter",
    image: undefined,
    bio: undefined,
  };

  const orgPublisher: PublicPublisher = {
    _id: "publisher-openclaw" as Id<"publishers">,
    _creationTime: 1,
    kind: "org",
    handle: "openclaw",
    displayName: "OpenClaw",
    official: true,
    image: undefined,
    bio: undefined,
    linkedUserId: undefined,
  };

  function renderBadge(badgeUser: PublicUser | PublicPublisher) {
    return render(
      <TooltipProvider>
        <UserBadge user={badgeUser} />
      </TooltipProvider>,
    );
  }

  it("links users to canonical publisher profiles", () => {
    renderBadge(user);

    expect(screen.getByRole("link", { name: "View @steipete profile" }).getAttribute("href")).toBe(
      "/user/steipete",
    );
  });

  it("links org publishers to canonical publisher profiles", () => {
    renderBadge(orgPublisher);

    expect(screen.getByRole("link", { name: "View @openclaw profile" }).getAttribute("href")).toBe(
      "/user/openclaw",
    );
  });

  it("shows muted handle beside display name in sidebar creator layout", () => {
    const publisher: PublicPublisher = {
      ...orgPublisher,
      _id: "publisher-acme" as Id<"publishers">,
      handle: "acme-corp",
      displayName: "Acme",
    };

    const { container } = render(
      <TooltipProvider>
        <UserBadge
          user={publisher}
          prefix=""
          showName
          showHandle={false}
          showMutedHandle
          disableTooltip
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("@acme-corp")).toBeTruthy();
    expect(container.querySelector(".user-handle-muted")).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Acme profile" }).getAttribute("href")).toBe(
      "/user/acme-corp",
    );
  });

  it("shows muted handle even when it matches the display name", () => {
    const publisher: PublicPublisher = {
      ...orgPublisher,
      _id: "publisher-pskoett" as Id<"publishers">,
      handle: "pskoett",
      displayName: "pskoett",
    };

    const { container } = render(
      <TooltipProvider>
        <UserBadge
          user={publisher}
          prefix=""
          showName
          showHandle={false}
          showMutedHandle
          disableTooltip
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("pskoett")).toBeTruthy();
    expect(screen.getByText("@pskoett")).toBeTruthy();
    expect(container.querySelector(".user-handle-muted")).toBeTruthy();
  });

  it("links using fallbackHandle when the user record has no handle", () => {
    const publisher: PublicPublisher = {
      ...orgPublisher,
      handle: undefined as unknown as string,
      displayName: "OpenClaw",
    };

    render(
      <TooltipProvider>
        <UserBadge
          user={publisher}
          fallbackHandle="openclaw"
          prefix=""
          showName
          showHandle={false}
          disableTooltip
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("link", { name: "View OpenClaw profile" }).getAttribute("href")).toBe(
      "/user/openclaw",
    );
  });

  it("shows a compact Official badge for official publishers", () => {
    const { container } = renderBadge(orgPublisher);

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(container.querySelector(".official-badge")).toBeTruthy();
    expect(container.querySelector(".official-tag")).toBeFalsy();
  });

  it("falls back to the legacy hover metric during rollout", () => {
    expect(
      getHoverTotalDownloads({
        publishedSkills: 1,
        totalStars: 2,
        totalInstalls: 42,
      }),
    ).toBe(42);
  });
});
