import { beforeEach, describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((options: unknown) => ({ redirect: options }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({ __config: config }),
  notFound: () => ({ notFound: true }),
  redirect: (options: unknown) => redirectMock(options),
}));

type RedirectRoute = {
  __config: {
    beforeLoad: (args: { location: { pathname: string }; params: Record<string, string> }) => never;
  };
};

async function loadRoute(path: string): Promise<RedirectRoute> {
  return ((await import(path)) as { Route: RedirectRoute }).Route;
}

describe("scoped plugin route redirects", () => {
  beforeEach(() => {
    redirectMock.mockClear();
  });

  it("canonicalizes raw scoped plugin detail paths", async () => {
    const route = await loadRoute("../routes/plugins/$scope/$name");

    expect(() =>
      route.__config.beforeLoad({
        location: { pathname: "/plugins/@clawkit/clawkit-creative-studio" },
        params: { scope: "@clawkit", name: "clawkit-creative-studio" },
      }),
    ).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      href: "/plugins/%40clawkit%2Fclawkit-creative-studio",
      statusCode: 308,
    });
  });

  it("canonicalizes raw scoped plugin security paths", async () => {
    const route = await loadRoute("../routes/plugins/$scope/$name/security/$scanner");

    expect(() =>
      route.__config.beforeLoad({
        location: { pathname: "/plugins/@clawkit/clawkit-creative-studio/security/virustotal" },
        params: { scope: "@clawkit", name: "clawkit-creative-studio", scanner: "virustotal" },
      }),
    ).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      href: "/plugins/%40clawkit%2Fclawkit-creative-studio/security/virustotal",
      statusCode: 308,
    });
  });

  it("preserves nested security paths through the scoped plugin parent", async () => {
    const route = await loadRoute("../routes/plugins/$scope/$name");

    expect(() =>
      route.__config.beforeLoad({
        location: { pathname: "/plugins/@clawkit/clawkit-creative-studio/security/virustotal" },
        params: { scope: "@clawkit", name: "clawkit-creative-studio" },
      }),
    ).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      href: "/plugins/%40clawkit%2Fclawkit-creative-studio/security/virustotal",
      statusCode: 308,
    });
  });

  it("canonicalizes raw scoped legacy package paths", async () => {
    const route = await loadRoute("../routes/packages/$scope/$name");

    expect(() =>
      route.__config.beforeLoad({
        location: { pathname: "/packages/@clawkit/clawkit-creative-studio" },
        params: { scope: "@clawkit", name: "clawkit-creative-studio" },
      }),
    ).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      href: "/plugins/%40clawkit%2Fclawkit-creative-studio",
      statusCode: 308,
    });
  });
});
