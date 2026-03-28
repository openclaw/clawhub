import { beforeAll, describe, expect, it } from "vitest";
import { NotFoundPage } from "./components/NotFoundPage";

describe("getRouter", () => {
  beforeAll(() => {
    process.env.VITE_CONVEX_URL = "https://example.convex.cloud";
    process.env.VITE_CONVEX_SITE_URL = "https://example.convex.site";
    process.env.SITE_URL = "http://localhost:3000";
  });

  it("registers the shared not found component", async () => {
    const { getRouter } = await import("./router");
    const router = getRouter();

    expect(router.options.defaultNotFoundComponent).toBe(NotFoundPage);
  });
});
