/* @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const convexQueryMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => convexQueryMock(...args) },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: { publishers: { getHomePublisherSummaries: "publishers:getHomePublisherSummaries" } },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    params,
    to: _to,
    ...props
  }: {
    children: React.ReactNode;
    className?: string;
    params?: { handle?: string; slug?: string };
    to?: string;
    [key: string]: unknown;
  }) => (
    <a
      {...props}
      className={className}
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
    convexQueryMock.mockReset();
    convexQueryMock.mockResolvedValue(null);
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

  it("loads all pinned publisher summaries once when the section nears the viewport", async () => {
    convexQueryMock.mockResolvedValue([
      {
        _id: "publishers:openclaw",
        _creationTime: 1,
        handle: "openclaw",
        displayName: "OpenClaw Registry",
        kind: "org",
        stats: { skills: 2, packages: 1, installs: 3, downloads: 4, stars: 5 },
      },
    ]);

    render(<HomePopularPublishersSection />);

    expect(convexQueryMock).not.toHaveBeenCalled();
    expect(screen.getAllByText("Explore creator")).toHaveLength(10);

    await enterPublisherSection();
    await waitFor(() => expect(convexQueryMock).toHaveBeenCalledTimes(1));
    expect(convexQueryMock).toHaveBeenCalledWith("publishers:getHomePublisherSummaries", {
      handles: [
        "openclaw",
        "nvidia",
        "steipete",
        "mvanhorn",
        "wscats",
        "ivangdavila",
        "byungkyu",
        "pskoett",
        "1kalin",
        "spclaudehome",
      ],
    });
    expect(screen.getByRole("link", { name: "OpenClaw Registry, @openclaw" })).toBeTruthy();
    expect(screen.getByText("Explore 3 items")).toBeTruthy();

    await enterPublisherSection();
    expect(convexQueryMock).toHaveBeenCalledTimes(1);
  });

  it("keeps static publisher cards when summary loading fails", async () => {
    convexQueryMock.mockRejectedValue(new Error("offline"));

    render(<HomePopularPublishersSection />);
    await enterPublisherSection();

    await waitFor(() => expect(convexQueryMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("link", { name: "OpenClaw, @openclaw" })).toBeTruthy();
    expect(screen.getAllByText("Explore creator")).toHaveLength(10);
  });

  it("keeps creator cards clickable until the pointer actually drags", () => {
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => false);
    const releasePointerCapture = vi.fn();

    render(<HomePopularPublishersSection />);

    const card = screen.getByRole("link", { name: "OpenClaw, @openclaw" });
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
