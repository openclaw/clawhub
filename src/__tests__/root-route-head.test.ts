import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (config: unknown) => ({ __config: config }),
  HeadContent: () => null,
  redirect: (options: unknown) => ({ redirect: options }),
  Scripts: () => null,
  useLocation: () => ({ pathname: "/" }),
}));

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => null,
}));

vi.mock("@vercel/speed-insights/react", () => ({
  SpeedInsights: () => null,
}));

vi.mock("../components/AppProviders", () => ({
  AppProviders: ({ children }: { children: unknown }) => children,
}));

vi.mock("../components/ClientOnly", () => ({
  ClientOnly: ({ children }: { children: unknown }) => children,
}));

vi.mock("../components/DeploymentDriftBanner", () => ({
  DeploymentDriftBanner: () => null,
}));

vi.mock("../components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));

vi.mock("../components/Footer", () => ({
  Footer: () => null,
}));

vi.mock("../components/GenericNotFoundPage", () => ({
  GenericNotFoundPage: () => null,
}));

vi.mock("../components/Header", () => ({
  default: () => null,
}));

vi.mock("sonner", () => ({
  Toaster: () => null,
}));

vi.mock("../styles.css?url", () => ({
  default: "/src/styles.css",
}));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_SITE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

type RootHead = {
  meta?: Array<{
    property?: string;
    name?: string;
    content?: string;
  }>;
};

function metaContent(head: RootHead, key: "property" | "name", value: string) {
  return head.meta?.find((entry) => entry[key] === value)?.content;
}

async function loadRootHead() {
  const route = (await import("../routes/__root")).Route as unknown as {
    __config: {
      head?: () => RootHead;
    };
  };

  return route.__config.head?.();
}

describe("root route head", () => {
  it("uses the versioned default social image for Open Graph and Twitter", async () => {
    const head = await loadRootHead();
    const expectedImage = "https://clawhub.ai/og.png?v=20260624-1";

    expect(metaContent(head ?? {}, "property", "og:image")).toBe(expectedImage);
    expect(metaContent(head ?? {}, "name", "twitter:image")).toBe(expectedImage);
    expect(metaContent(head ?? {}, "property", "og:image:width")).toBe("1200");
    expect(metaContent(head ?? {}, "property", "og:image:height")).toBe("630");
  });
});
