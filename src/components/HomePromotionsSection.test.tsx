/* @vitest-environment jsdom */
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomePromotionsSection } from "./HomePromotionsSection";

const { fetchMock, publicApiUrlMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  publicApiUrlMock: vi.fn(),
}));

vi.mock("../lib/publicApiUrl", () => ({
  publicApiUrl: publicApiUrlMock,
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

function promotionsResponse(promotions: Array<typeof promotion>) {
  return new Response(JSON.stringify({ promotions }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HomePromotionsSection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    fetchMock.mockReset();
    publicApiUrlMock.mockReset();
    publicApiUrlMock.mockReturnValue(new URL("https://clawhub.test/api/v1/promotions"));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls for promotions that become active while the page is open", async () => {
    fetchMock
      .mockResolvedValueOnce(promotionsResponse([]))
      .mockResolvedValueOnce(
        promotionsResponse([{ ...promotion, startsAt: 120_000, endsAt: 200_000 }]),
      );

    render(<HomePromotionsSection />);
    await flushPromises();
    expect(screen.queryByText(promotion.title)).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://clawhub.test/api/v1/promotions");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://clawhub.test/api/v1/promotions");
    expect(screen.getByText(promotion.title)).toBeTruthy();
  });

  it("removes a promotion at its expiry boundary and refreshes the query", async () => {
    fetchMock
      .mockResolvedValueOnce(promotionsResponse([{ ...promotion, endsAt: 100_500 }]))
      .mockResolvedValueOnce(promotionsResponse([]));

    render(<HomePromotionsSection />);
    await flushPromises();
    expect(screen.getByText(promotion.title)).toBeTruthy();
    expect(screen.getByText("Available at no cost until January 1, 1970.")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(501);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(promotion.title)).toBeNull();
  });
});
