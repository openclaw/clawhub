/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { beforeLoad?: unknown }) => ({ __config: config }),
  redirect: (options: unknown) => ({ redirect: options }),
}));

vi.mock("../convex/client", () => ({
  convexHttp: {
    query: vi.fn(),
  },
}));

import { Route } from "../routes/index";

function runBeforeLoad(url = "https://clawhub.ai/") {
  const route = Route as unknown as {
    __config: {
      beforeLoad?: (args: {
        location: { url: URL };
      }) => void;
    };
  };
  const beforeLoad = route.__config.beforeLoad as
    | ((args: { location: { url: URL } }) => void)
    | undefined;
  if (!beforeLoad) return undefined;

  let thrown: unknown;
  try {
    beforeLoad({ location: { url: new URL(url) } });
  } catch (error) {
    thrown = error;
  }
  return thrown;
}

describe("root route", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.isKnot;
    delete document.documentElement.dataset.knotSiteUrl;
    vi.unstubAllEnvs();
  });

  it("redirects knot root when IS_KNOT is set", () => {
    vi.stubEnv("IS_KNOT", "true");
    vi.stubEnv("SITE_URL", "http://localhost:3000");

    expect(runBeforeLoad()).toEqual({
      redirect: {
        href: "http://localhost:3000",
        replace: true,
      },
    });
  });

  it("redirects knot root to the configured site URL", () => {
    document.documentElement.dataset.isKnot = "true";
    document.documentElement.dataset.knotSiteUrl = "https://openclaw.openknot.ai";

    expect(runBeforeLoad()).toEqual({
      redirect: {
        href: "https://openclaw.openknot.ai",
        replace: true,
      },
    });
  });

  it("does not redirect when already on the knot site", () => {
    document.documentElement.dataset.isKnot = "true";
    document.documentElement.dataset.knotSiteUrl = "https://openclaw.openknot.ai";

    expect(runBeforeLoad("https://openclaw.openknot.ai/")).toBeUndefined();
  });

  it("does not redirect when knot mode is disabled", () => {
    expect(runBeforeLoad()).toBeUndefined();
  });
});
