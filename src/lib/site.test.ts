/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectSiteMode,
  detectSiteModeFromUrl,
  getKnotSiteUrl,
  getClawHubSiteUrl,
  getOnlyCrabsHost,
  getOnlyCrabsSiteUrl,
  getSiteDescription,
  getSiteMode,
  getSiteName,
  getSiteUrlForMode,
  isKnotEnabled,
} from "./site";

function withServerEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("site helpers", () => {
  it("returns default and env configured site URLs", () => {
    expect(getClawHubSiteUrl()).toBe("https://clawhub.ai");
    withServerEnv({ VITE_SITE_URL: "https://example.com" }, () => {
      expect(getClawHubSiteUrl()).toBe("https://example.com");
    });
    withServerEnv({ VITE_SITE_URL: "https://clawdhub.com" }, () => {
      expect(getClawHubSiteUrl()).toBe("https://clawhub.ai");
    });
    withServerEnv({ VITE_SITE_URL: "https://auth.clawdhub.com" }, () => {
      expect(getClawHubSiteUrl()).toBe("https://clawhub.ai");
    });
  });

  it("uses the knot site URL when knot mode is enabled", () => {
    vi.stubGlobal("document", {
      documentElement: {
        dataset: {
          isKnot: "true",
          knotSiteUrl: "https://openclaw.openknot.ai",
        },
      },
    } as unknown as Document);

    expect(getClawHubSiteUrl()).toBe("https://openclaw.openknot.ai");
  });

  it("picks SoulHub URL from explicit env", () => {
    withServerEnv({ VITE_SOULHUB_SITE_URL: "https://souls.example.com" }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe("https://souls.example.com");
    });
  });

  it("detects knot mode from env or document data", () => {
    withServerEnv({ IS_KNOT: "true" }, () => {
      expect(isKnotEnabled()).toBe(true);
    });

    withServerEnv({ IS_KNOT: "false" }, () => {
      expect(isKnotEnabled()).toBe(false);
    });

    vi.stubGlobal("document", {
      documentElement: { dataset: { isKnot: "true" } },
    } as unknown as Document);

    expect(isKnotEnabled()).toBe(true);
  });

  it("returns the knot site URL from document data, env, or default", () => {
    vi.stubGlobal("document", {
      documentElement: { dataset: { knotSiteUrl: "https://openclaw.openknot.ai" } },
    } as unknown as Document);

    expect(getKnotSiteUrl()).toBe("https://openclaw.openknot.ai");

    vi.unstubAllGlobals();

    withServerEnv({ SITE_URL: "http://localhost:3000" }, () => {
      expect(getKnotSiteUrl()).toBe("http://localhost:3000");
    });

    withServerEnv({ VITE_SITE_URL: "https://openclaw.openknot.ai" }, () => {
      expect(getKnotSiteUrl()).toBe("https://openclaw.openknot.ai");
    });

    withServerEnv({ VITE_SITE_URL: "not a url", SITE_URL: undefined }, () => {
      expect(getKnotSiteUrl()).toBe("https://openclaw.openknot.ai");
    });
  });

  it("derives SoulHub URL from local VITE_SITE_URL", () => {
    withServerEnv({ VITE_SITE_URL: "http://localhost:3000" }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe("http://localhost:3000");
    });
    withServerEnv({ VITE_SITE_URL: "http://127.0.0.1:3000" }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe("http://127.0.0.1:3000");
    });
    withServerEnv({ VITE_SITE_URL: "http://0.0.0.0:3000" }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe("http://0.0.0.0:3000");
    });
  });

  it("falls back to default SoulHub URL for invalid VITE_SITE_URL", () => {
    withServerEnv({ VITE_SITE_URL: "not a url" }, () => {
      expect(getOnlyCrabsSiteUrl()).toBe("https://onlycrabs.ai");
    });
  });

  it("detects site mode from host and URLs", () => {
    expect(detectSiteMode(null)).toBe("skills");

    withServerEnv({ VITE_SOULHUB_HOST: "souls.example.com" }, () => {
      expect(getOnlyCrabsHost()).toBe("souls.example.com");
      expect(detectSiteMode("souls.example.com")).toBe("souls");
      expect(detectSiteMode("sub.souls.example.com")).toBe("souls");
      expect(detectSiteMode("clawhub.ai")).toBe("skills");

      expect(detectSiteModeFromUrl("https://souls.example.com/x")).toBe("souls");
      expect(detectSiteModeFromUrl("souls.example.com")).toBe("souls");
      expect(detectSiteModeFromUrl("https://clawhub.ai")).toBe("skills");
    });
  });

  it("detects site mode from window when available", () => {
    withServerEnv({ VITE_SOULHUB_HOST: "onlycrabs.ai" }, () => {
      vi.stubGlobal("window", { location: { hostname: "onlycrabs.ai" } } as unknown as Window);
      expect(getSiteMode()).toBe("souls");
    });
  });

  it("detects site mode from env on the server", () => {
    withServerEnv({ VITE_SITE_MODE: "souls", VITE_SOULHUB_HOST: "onlycrabs.ai" }, () => {
      expect(getSiteMode()).toBe("souls");
    });
    withServerEnv({ VITE_SITE_MODE: "skills", VITE_SOULHUB_HOST: "onlycrabs.ai" }, () => {
      expect(getSiteMode()).toBe("skills");
    });
  });

  it("detects site mode from VITE_SOULHUB_SITE_URL and SITE_URL fallback", () => {
    withServerEnv(
      { VITE_SITE_MODE: undefined, VITE_SOULHUB_SITE_URL: "https://onlycrabs.ai" },
      () => {
        expect(getSiteMode()).toBe("souls");
      },
    );

    withServerEnv({ VITE_SOULHUB_SITE_URL: undefined, VITE_SITE_URL: undefined }, () => {
      vi.stubEnv("SITE_URL", "https://onlycrabs.ai");
      expect(getSiteMode()).toBe("souls");
    });
  });

  it("derives site metadata from mode", () => {
    expect(getSiteName("skills")).toBe("ClawHub");
    expect(getSiteName("souls")).toBe("SoulHub");

    expect(getSiteDescription("skills")).toContain("ClawHub");
    expect(getSiteDescription("souls")).toContain("SoulHub");

    expect(getSiteUrlForMode("skills")).toBe("https://clawhub.ai");
    expect(getSiteUrlForMode("souls")).toBe("https://onlycrabs.ai");
  });
});
