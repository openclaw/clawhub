/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const convexQueryMock = vi.fn();

vi.mock("../convex/client", () => ({
  convexHttp: { query: (...args: unknown[]) => convexQueryMock(...args) },
}));

vi.mock("../../convex/_generated/api", () => ({
  api: { publishers: { getProfileByHandle: "publishers:getProfileByHandle" } },
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
    params?: { handle?: string };
    to?: string;
    [key: string]: unknown;
  }) => (
    <a
      {...props}
      className={className}
      href={params?.handle ? `/user/${params.handle}` : "/publishers"}
    >
      {children}
    </a>
  ),
}));

import { HomePopularPublishersSection } from "../components/HomePopularPublishersSection";

describe("HomePopularPublishersSection", () => {
  beforeEach(() => {
    convexQueryMock.mockReset();
    convexQueryMock.mockResolvedValue(null);
  });

  it("keeps creator cards clickable until the pointer actually drags", () => {
    const setPointerCapture = vi.fn();
    const hasPointerCapture = vi.fn(() => false);
    const releasePointerCapture = vi.fn();

    render(<HomePopularPublishersSection />);

    const card = screen.getByRole("link", { name: "OpenClaw, @openclaw" });
    expect(card.getAttribute("href")).toBe("/user/openclaw");
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
