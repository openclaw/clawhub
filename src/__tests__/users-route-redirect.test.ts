import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn((options: unknown) => ({ redirect: options }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: {
      beforeLoad?: (args: {
        params: Record<string, string>;
        search: Record<string, unknown>;
      }) => unknown;
    }) => ({
      __config: config,
    }),
  redirect: (options: unknown) => redirectMock(options),
}));

describe("users route redirect", () => {
  it("redirects legacy /users traffic to /official", async () => {
    const route = (await import("../routes/users/index")).Route as unknown as {
      __config: { beforeLoad: (args: { search: Record<string, unknown> }) => unknown };
    };

    const search = { q: "builder" };

    expect(() => route.__config.beforeLoad({ search })).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({ to: "/official", search, replace: true });
  });

  it("redirects legacy /publishers traffic to /official", async () => {
    const route = (await import("../routes/publishers/index")).Route as unknown as {
      __config: { beforeLoad: (args: { search: Record<string, unknown> }) => unknown };
    };

    const search = { kind: "orgs", q: "acme" };

    expect(() => route.__config.beforeLoad({ search })).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({ to: "/official", search, replace: true });
  });

  it("redirects legacy /p profile routes to user profiles", async () => {
    const route = (await import("../routes/p/$handle")).Route as unknown as {
      __config: {
        beforeLoad: (args: {
          params: { handle: string };
          search: Record<string, unknown>;
        }) => unknown;
      };
    };

    expect(() => route.__config.beforeLoad({ params: { handle: "alice" }, search: {} })).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      href: "/alice",
      replace: true,
    });
  });

  it("redirects legacy user profile routes to user profiles", async () => {
    const route = (await import("../routes/u/$handle")).Route as unknown as {
      __config: {
        beforeLoad: (args: {
          params: { handle: string };
          search: Record<string, unknown>;
        }) => unknown;
      };
    };

    expect(() => route.__config.beforeLoad({ params: { handle: "alice" }, search: {} })).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      href: "/alice",
      replace: true,
    });
  });

  it("keeps existing official-alias publishers reachable from the legacy profile route", async () => {
    const route = (await import("../routes/user/$handle")).Route as unknown as {
      __config: {
        beforeLoad: (args: {
          params: { handle: string };
          search: Record<string, unknown>;
        }) => unknown;
      };
    };

    redirectMock.mockClear();
    expect(() =>
      route.__config.beforeLoad({ params: { handle: "tencent" }, search: {} }),
    ).not.toThrow();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("redirects legacy org profile routes to publisher profiles", async () => {
    const route = (await import("../routes/orgs/$handle")).Route as unknown as {
      __config: {
        beforeLoad: (args: {
          params: { handle: string };
          search: Record<string, unknown>;
        }) => unknown;
      };
    };

    expect(() =>
      route.__config.beforeLoad({ params: { handle: "openclaw" }, search: {} }),
    ).toThrow();
    expect(redirectMock).toHaveBeenCalledWith({
      href: "/openclaw",
      replace: true,
    });
  });
});
