/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const convexActionMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: { action: (...args: unknown[]) => convexActionMock(...args) },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: {
    publishers: {
      getHomeOfficialCreatorSummaries: "publishers:getHomeOfficialCreatorSummaries",
    },
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    search,
    to: _to,
    ...props
  }: {
    children: React.ReactNode;
    className?: string;
    params?: { handle?: string; slug?: string };
    to?: string;
    search?: unknown;
    [key: string]: unknown;
  }) => (
    <a
      {...props}
      className={className}
      data-search={search ? JSON.stringify(search) : undefined}
      href={
        params?.slug ? `/${params.slug}` : params?.handle ? `/user/${params.handle}` : "/creators"
      }
    >
      {children}
    </a>
  ),
}));

import { HomePopularPublishersSection } from "../components/HomePopularPublishersSection";

describe("HomePopularPublishersSection", () => {
  let intersectionCallback: IntersectionObserverCallback;

  beforeEach(() => {
    convexActionMock.mockReset();
    convexActionMock.mockResolvedValue([]);
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersectionCallback = callback;
        }

        observe = vi.fn();
        disconnect = vi.fn();
        unobserve = vi.fn();
        takeRecords = vi.fn(() => []);
        root = null;
        rootMargin = "600px 0px";
        thresholds = [0];
      },
    );
  });

  const enterPublisherSection = async () => {
    await act(async () => {
      intersectionCallback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
      await Promise.resolve();
    });
  };

  it("loads the top twelve official creators once when the section nears the viewport", async () => {
    convexActionMock.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        _id: `publishers:org-${index}`,
        _creationTime: index,
        handle: `org-${index}`,
        displayName: `Official Org ${index}`,
        kind: "org",
        stats: {
          skills: 2,
          packages: 1,
          installs: 12 - index,
          downloads: 4,
          stars: 5,
        },
      })),
    );

    render(<HomePopularPublishersSection />);

    expect(convexActionMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Official creators" })).toBeTruthy();
    expect(screen.getByText("Explore skills and plugins from official creators.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse creators" }).dataset.search).toBe(
      '{"official":true,"kind":"orgs"}',
    );

    await enterPublisherSection();
    await waitFor(() => expect(convexActionMock).toHaveBeenCalledTimes(1));
    expect(convexActionMock).toHaveBeenCalledWith("publishers:getHomeOfficialCreatorSummaries", {
      limit: 12,
    });
    expect(screen.getAllByRole("link", { name: /Official Org/ })).toHaveLength(12);
    expect(screen.getByText("12 installs")).toBeTruthy();
    expect(screen.getByText("1 install")).toBeTruthy();
    expect(document.querySelectorAll(".home-v2-popular-publisher-card")).toHaveLength(12);
    expect(
      Array.from(document.querySelectorAll(".home-v2-popular-publisher-card"), (card) =>
        card.getAttribute("aria-label"),
      ),
    ).toEqual(Array.from({ length: 12 }, (_, index) => `Official Org ${index}, @org-${index}`));

    await enterPublisherSection();
    expect(convexActionMock).toHaveBeenCalledTimes(1);
  });

  it("retries a failed official creator request", async () => {
    convexActionMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        handle: "openclaw",
        displayName: "OpenClaw",
        kind: "org",
        stats: { skills: 2, packages: 1, installs: 3, downloads: 4, stars: 5 },
      },
    ]);

    render(<HomePopularPublishersSection />);
    await enterPublisherSection();

    await waitFor(() => expect(convexActionMock).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll(".home-v2-popular-publisher-card")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(convexActionMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("link", { name: "OpenClaw, @openclaw" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps creator cards clickable until the pointer actually drags", async () => {
    convexActionMock.mockResolvedValue([
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        handle: "openclaw",
        displayName: "OpenClaw",
        kind: "org",
        stats: { skills: 2, packages: 1, installs: 3, downloads: 4, stars: 5 },
      },
    ]);
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => false);
    const releasePointerCapture = vi.fn();

    render(<HomePopularPublishersSection />);
    await enterPublisherSection();

    const card = await screen.findByRole("link", { name: "OpenClaw, @openclaw" });
    expect(card.getAttribute("href")).toBe("/openclaw");
    const viewport = document.querySelector(".home-v2-popular-publishers-viewport");
    expect(viewport).toBeTruthy();
    Object.assign(viewport!, { setPointerCapture, hasPointerCapture, releasePointerCapture });

    fireEvent.pointerDown(viewport!, {
      pointerType: "mouse",
      button: 0,
      pointerId: 7,
      clientX: 100,
    });
    expect(setPointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerMove(viewport!, { pointerType: "mouse", pointerId: 7, clientX: 90 });
    expect(setPointerCapture).toHaveBeenCalledWith(7);
  });
});
