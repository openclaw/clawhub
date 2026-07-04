/* @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePromotionsSection } from "./HomePromotionsSection";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: queryMock,
  },
}));

const promotion = {
  slug: "example-models-launch",
  title: "Free Example models",
  blurb: "A limited-time free model offer from Example.",
  status: "active",
  active: true,
  startsAt: 0,
  endsAt: 0,
  models: [{ modelRef: "example-provider/example/model-alpha" }],
};

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("HomePromotionsSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    queryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("polls for promotions that become active while the page is open", async () => {
    queryMock
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ ...promotion, startsAt: 120_000, endsAt: 200_000 }] as never);

    render(<HomePromotionsSection />);
    await flushPromises();
    expect(screen.queryByText(promotion.title)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText(promotion.title)).toBeTruthy();
  });

  it("removes a promotion at its expiry boundary and refreshes the query", async () => {
    queryMock
      .mockResolvedValueOnce([{ ...promotion, endsAt: 100_500 }] as never)
      .mockResolvedValueOnce([] as never);

    render(<HomePromotionsSection />);
    await flushPromises();
    expect(screen.getByText(promotion.title)).toBeTruthy();
    expect(screen.getByText("Ends today")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(501);
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(promotion.title)).toBeNull();
  });
});
