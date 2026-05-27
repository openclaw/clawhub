/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import type { PublicPublisherListItem } from "../lib/publicUser";
import { PublisherListItem } from "./PublisherListItem";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to?: string }) => <a href={to}>{children}</a>,
}));

describe("PublisherListItem", () => {
  it("renders official publishers with the compact official mark", () => {
    const { container } = render(<PublisherListItem publisher={makePublisher()} />);

    expect(screen.getByLabelText("Official")).toBeTruthy();
    expect(screen.queryByText("Official")).toBeNull();
    expect(container.querySelector(".official-badge")).toBeTruthy();
  });
});

function makePublisher(): PublicPublisherListItem {
  return {
    _id: "publishers:openclaw" as Id<"publishers">,
    _creationTime: 1,
    kind: "org",
    handle: "openclaw",
    displayName: "OpenClaw",
    image: undefined,
    bio: "Official publisher",
    linkedUserId: undefined,
    official: true,
    stats: {
      skills: 1,
      packages: 1,
      installs: 0,
      downloads: 12,
      stars: 3,
    },
    publishedItems: [],
  };
}
