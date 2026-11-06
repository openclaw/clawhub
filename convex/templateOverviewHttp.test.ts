import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/httpRateLimit", () => ({
  applyRateLimit: async () => ({ ok: true, headers: { "X-RateLimit-Remaining": "99" } }),
}));
import { get } from "./templateOverviewHttp";

const handler = (
  get as unknown as {
    _handler: (ctx: unknown, request: Request) => Promise<Response>;
  }
)._handler;
const request = () => new Request("https://example.invalid/api/v1/templates/overview?limit=8");

describe("Template overview budget fallback", () => {
  it("returns explicit fallback for a large-document transaction read limit", async () => {
    // Simulate the platform error: convex-test does not enforce native read-byte limits.
    const runQuery = vi.fn(async () => {
      const maximumBytes = 16 * 1024 * 1024;
      let bytes = 0;
      for (let index = 0; index < 1000; index += 1) {
        bytes += JSON.stringify({
          latestVersionSummary: { changelog: "x".repeat(20 * 1024) },
        }).length;
        if (bytes > maximumBytes) {
          throw new Error(
            "Too many bytes read in a single function execution (limit: 16777216 bytes).",
          );
        }
      }
      throw Error("Fixture must exceed the platform byte limit");
    });
    const response = await handler({ runQuery }, request());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("99");
    expect(await response.json()).toEqual({ complete: false, featured: [], sections: [] });
  });

  it.each(["Unauthorized", "Rate limit exceeded", "fetch failed", "Internal server error"])(
    "does not hide unrelated failure: %s",
    async (message) => {
      const error = new Error(message);
      await expect(handler({ runQuery: vi.fn().mockRejectedValue(error) }, request())).rejects.toBe(
        error,
      );
    },
  );
});
