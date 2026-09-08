import { afterEach, expect, it, vi } from "vitest";
import { buildSearchDigest } from "./searchDigest";
import { deliverSearchDigest } from "./searchDigestDelivery";

afterEach(() => vi.unstubAllGlobals());
const payload = buildSearchDigest({
  weekEnd: Date.parse("2026-09-07T00:00:00Z"),
  siteUrl: "https://clawhub.ai",
  totalSearches7d: 0,
  sources7d: { "clawhub-web": 0, "openclaw-control-ui": 0 },
  rows: [],
  classificationStatus: "unavailable",
  currentMetadataStatus: "unavailable",
  truncated: false,
});

it("sends only the frozen aggregate contract to authenticated Hermit and accepts confirmed duplicate receipt", async () => {
  const request = vi.fn(async () =>
    Response.json({ ok: true, delivered: true, duplicate: true, weekEnd: payload.weekEnd }),
  );
  vi.stubGlobal("fetch", request);
  expect(
    await deliverSearchDigest(payload, "https://forms.openclaw.ai", "fixture-hermit-token"),
  ).toEqual({ delivered: true });
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]).toEqual([
    "https://forms.openclaw.ai/api/clawhub-search-intelligence/weekly",
    expect.objectContaining({
      method: "POST",
      redirect: "error",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json", Authorization: "Bearer fixture-hermit-token" },
    }),
  ]);
});

it.each([
  [409, { ok: false, error: "uncertain" }],
  [200, { ok: true, delivered: true, weekEnd: 0 }],
  [200, { ok: true, delivered: false, weekEnd: payload.weekEnd }],
  [500, { error: "sensitive response" }],
])(
  "records a query-free failure for incomplete Hermit acknowledgement %s",
  async (status, response) => {
    vi.stubGlobal("fetch", async () => Response.json(response, { status }));
    const result = await deliverSearchDigest(
      payload,
      "https://forms.openclaw.ai",
      "fixture-hermit-token",
    );
    expect(result.delivered).toBe(false);
    expect(JSON.stringify(result)).not.toContain("sensitive");
  },
);
