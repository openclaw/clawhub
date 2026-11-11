import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  createRootRoute: (config: unknown) => ({ __config: config }),
  HeadContent: () => null,
  redirect: (options: unknown) => ({ redirect: options }),
  Scripts: () => null,
  useLocation: () => ({ pathname: "/" }),
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
  it("matches the homepage message in search, Open Graph and Twitter", async () => {
    const head = (await loadRootHead()) ?? {};
    const title = "Tools for your agents";
    const description = "Discover skills and plugins from top creators";

    expect(metaContent(head, "property", "og:site_name")).toBe("ClawHub");
    expect(metaContent(head, "name", "description")).toBe(description);
    for (const [key, prefix] of [
      ["property", "og"],
      ["name", "twitter"],
    ] as const) {
      expect(metaContent(head, key, `${prefix}:title`)).toBe(title);
      expect(metaContent(head, key, `${prefix}:description`)).toBe(description);
      expect(metaContent(head, key, `${prefix}:image:alt`)).toBe(`${title}. ${description}`);
    }
  });

  it("uses the versioned default social image for Open Graph and Twitter", async () => {
    const head = await loadRootHead();
    const expectedImage = "https://clawhub.ai/og.png?v=20261111-2";

    expect(metaContent(head ?? {}, "property", "og:image")).toBe(expectedImage);
    expect(metaContent(head ?? {}, "name", "twitter:image")).toBe(expectedImage);
    expect(metaContent(head ?? {}, "property", "og:image:width")).toBe("1200");
    expect(metaContent(head ?? {}, "property", "og:image:height")).toBe("630");
  });
});
