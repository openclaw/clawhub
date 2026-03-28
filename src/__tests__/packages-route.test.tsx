/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPackagesMock = vi.fn();
const navigateMock = vi.fn();
let searchMock: Record<string, unknown> = {};
let loaderDataMock: {
  items: Array<{
    name: string;
    displayName: string;
    family: "skill" | "code-plugin" | "bundle-plugin";
    channel: "official" | "community" | "private";
    isOfficial: boolean;
    executesCode?: boolean;
    summary?: string | null;
    ownerHandle?: string | null;
    latestVersion?: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  nextCursor: string | null;
} = {
  items: [],
  nextCursor: null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: {
      loader?: (args: { deps: Record<string, unknown> }) => Promise<unknown>;
      component?: unknown;
      validateSearch?: unknown;
    }) => ({
      __config: config,
      useNavigate: () => navigateMock,
      useSearch: () => searchMock,
      useLoaderData: () => loaderDataMock,
    }),
  Link: (props: { children: ReactNode }) => <a href="/">{props.children}</a>,
}));

vi.mock("../lib/packageApi", () => ({
  fetchPackages: (...args: unknown[]) => fetchPackagesMock(...args),
}));

async function loadRoute() {
  return (await import("../routes/packages/index")).Route as unknown as {
    __config: {
      loader?: (args: { deps: Record<string, unknown> }) => Promise<unknown>;
      component?: ComponentType;
      validateSearch?: (search: Record<string, unknown>) => Record<string, unknown>;
    };
  };
}

describe("packages route", () => {
  beforeEach(() => {
    fetchPackagesMock.mockReset();
    navigateMock.mockReset();
    searchMock = {};
    loaderDataMock = { items: [], nextCursor: null };
  });

  it("preserves skill family filters in search state", async () => {
    const route = await loadRoute();
    const validateSearch = route.__config.validateSearch as (
      search: Record<string, unknown>,
    ) => Record<string, unknown>;

    expect(validateSearch({ family: "skill", q: "demo" })).toEqual({
      family: "skill",
      q: "demo",
      cursor: undefined,
      official: undefined,
      executesCode: undefined,
    });
  });

  it("forwards opaque cursors through the loader", async () => {
    fetchPackagesMock.mockResolvedValue({ items: [], nextCursor: "cursor:next" });
    const route = await loadRoute();
    const loader = route.__config.loader as (args: {
      deps: Record<string, unknown>;
    }) => Promise<unknown>;

    await loader({
      deps: {
        cursor: "cursor:current",
        family: "code-plugin",
      },
    });

    expect(fetchPackagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: "cursor:current",
        family: "code-plugin",
        limit: 50,
      }),
    );
  });

  it("renders next-page controls for browse mode", async () => {
    loaderDataMock = {
      items: [
        {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          executesCode: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      nextCursor: "cursor:next",
    };
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(navigateMock).toHaveBeenCalled();
    const lastCall = navigateMock.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(lastCall.search({ family: "code-plugin" })).toEqual({
      family: "code-plugin",
      cursor: "cursor:next",
    });
  });

  it("renders the Skills family option", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByRole("option", { name: "Skills" })).toBeTruthy();
  });
});
