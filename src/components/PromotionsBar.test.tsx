/* @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_EVENT, analyticsPublicResourcePlacement } from "../lib/analyticsEvents";
import { PromotionsBar } from "./PromotionsBar";

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

describe("PromotionsBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    fetchMock.mockReset();
    publicApiUrlMock.mockReset();
    publicApiUrlMock.mockReturnValue(new URL("https://clawhub.test/api/v1/promotions"));
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.analyticsAllowed;
    delete document.documentElement.dataset.analyticsConsentEpoch;
  });

  it("enriches the original promotion selection once without changing its identity or target", async () => {
    const href = "https://example.test/promotion?utm_source=fixture#offer";
    const activePromotion = { ...promotion, endsAt: 200_000, launchPageUrl: href };
    fetchMock.mockResolvedValue(promotionsResponse([activePromotion]));
    document.documentElement.dataset.analyticsAllowed = "true";
    document.documentElement.dataset.analyticsConsentEpoch = "automatic-public:1";
    const received: Array<{ name: string; params: unknown }> = [];
    const listener = (event: Event) => received.push((event as CustomEvent).detail);
    window.addEventListener(ANALYTICS_EVENT, listener);
    try {
      render(
        <section data-analytics-public-detail="">
          <PromotionsBar />
        </section>,
      );
      await flushPromises();
      const link = screen.getByRole("link", { name: /Try it free/ });
      link.addEventListener("click", (event) => event.preventDefault());
      fireEvent.click(link);
      expect(received.filter((event) => event.name === "select_content")).toEqual([
        expect.objectContaining({
          name: "select_content",
          params: {
            content_type: "navigation",
            content_id: `promotion:${activePromotion.slug}`,
            ui_location: "promotion",
            link_url: "https://example.test/promotion",
            link_domain: "example.test",
          },
        }),
      ]);
      expect(link.getAttribute("href")).toBe(href);
      expect(analyticsPublicResourcePlacement(link as HTMLAnchorElement)).toBeNull();
    } finally {
      window.removeEventListener(ANALYTICS_EVENT, listener);
    }
  });

  it("polls for promotions that become active while the page is open", async () => {
    fetchMock
      .mockResolvedValueOnce(promotionsResponse([]))
      .mockResolvedValueOnce(
        promotionsResponse([{ ...promotion, startsAt: 120_000, endsAt: 200_000 }]),
      );

    render(<PromotionsBar />);
    await flushPromises();
    expect(screen.queryByText(promotion.title)).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://clawhub.test/api/v1/promotions");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://clawhub.test/api/v1/promotions");
    expect(screen.getByText(promotion.title)).toBeTruthy();
    expect(screen.getByText(promotion.blurb)).toBeTruthy();
    expect(screen.queryByText("1 day left")).toBeNull();
  });

  it("removes a promotion at its expiry boundary and refreshes the query", async () => {
    fetchMock
      .mockResolvedValueOnce(promotionsResponse([{ ...promotion, endsAt: 100_500 }]))
      .mockResolvedValueOnce(promotionsResponse([]));

    render(<PromotionsBar />);
    await flushPromises();
    expect(screen.getByText(promotion.title)).toBeTruthy();
    expect(screen.getByText(promotion.blurb)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(501);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(promotion.title)).toBeNull();
  });

  it("keeps a dismissed promotion hidden for the same campaign window", async () => {
    const activePromotion = { ...promotion, endsAt: 200_000 };
    fetchMock.mockResolvedValue(promotionsResponse([activePromotion]));

    const { unmount } = render(<PromotionsBar />);
    await flushPromises();

    fireEvent.click(
      screen.getByRole("button", {
        name: `Dismiss ${activePromotion.title} promotion`,
      }),
    );

    expect(screen.queryByText(activePromotion.title)).toBeNull();
    expect(
      window.localStorage.getItem(
        `clawhub.promotion.dismissed.${activePromotion.slug}.${activePromotion.endsAt}`,
      ),
    ).toBe("1");

    unmount();
    render(<PromotionsBar />);
    await flushPromises();

    expect(screen.queryByText(activePromotion.title)).toBeNull();
  });

  it("shows a later campaign window after an earlier one was dismissed", async () => {
    const earlierPromotion = { ...promotion, endsAt: 200_000 };
    window.localStorage.setItem(
      `clawhub.promotion.dismissed.${earlierPromotion.slug}.${earlierPromotion.endsAt}`,
      "1",
    );
    fetchMock.mockResolvedValue(promotionsResponse([{ ...earlierPromotion, endsAt: 300_000 }]));

    render(<PromotionsBar />);
    await flushPromises();

    expect(screen.getByText(earlierPromotion.title)).toBeTruthy();
  });

  it("renders promotions when storage reads are unavailable", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    fetchMock.mockResolvedValue(promotionsResponse([{ ...promotion, endsAt: 200_000 }]));

    render(<PromotionsBar />);
    await flushPromises();

    expect(screen.getByText(promotion.title)).toBeTruthy();
  });

  it("dismisses the current promotion when storage writes are unavailable", async () => {
    const activePromotion = { ...promotion, endsAt: 200_000 };
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    fetchMock.mockResolvedValue(promotionsResponse([activePromotion]));

    render(<PromotionsBar />);
    await flushPromises();
    fireEvent.click(
      screen.getByRole("button", {
        name: `Dismiss ${activePromotion.title} promotion`,
      }),
    );

    expect(screen.queryByText(activePromotion.title)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(activePromotion.title)).toBeNull();
  });
});
