import { afterEach, describe, expect, it, vi } from "vitest";
import { publicApiUrl } from "./publicApiUrl";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("publicApiUrl", () => {
  it("keeps public-edge requests on the local frontend origin", () => {
    vi.stubGlobal("window", { location: new URL("http://127.0.0.1:4173/import") });
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://clawhub.ai");
    expect(publicApiUrl("/api/v1/promotions").href).toBe("http://127.0.0.1:4173/api/v1/promotions");
  });

  it.each(["http://127.0.0.1:3211", "https://preview-123.convex.site"])(
    "preserves direct local-development access to %s",
    (backend) => {
      vi.stubGlobal("window", { location: new URL("http://localhost:3000/import") });
      vi.stubEnv("VITE_CONVEX_SITE_URL", backend);
      expect(publicApiUrl("/api/v1/promotions").href).toBe(`${backend}/api/v1/promotions`);
    },
  );

  it("keeps hosted browser requests on the frontend origin", () => {
    vi.stubGlobal("window", { location: new URL("https://preview.example/import") });
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://preview-123.convex.site");
    expect(publicApiUrl("/api/v1/promotions").href).toBe(
      "https://preview.example/api/v1/promotions",
    );
  });
});
