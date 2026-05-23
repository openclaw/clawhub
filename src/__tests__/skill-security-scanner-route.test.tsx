/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();
const useAuthStatusMock = vi.fn();

let paramsMock = {
  owner: "local",
  slug: "local-agentic-risk-demo",
};
let loaderDataMock: {
  owner: string;
  displayName: string | null;
  summary: string | null;
  version: string | null;
  initialData?: { result?: unknown };
} = {
  owner: "local",
  displayName: "Local Agentic Risk Demo",
  summary: null,
  version: null,
  initialData: { result: undefined },
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: { component?: unknown; beforeLoad?: unknown; loader?: unknown; head?: unknown }) => ({
      __config: config,
      useParams: () => paramsMock,
      useLoaderData: () => loaderDataMock,
    }),
  notFound: () => ({ notFound: true }),
  redirect: (options: unknown) => ({ redirect: options }),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("../lib/skillPage", () => ({
  fetchSkillPageData: vi.fn(),
}));

async function loadRoute() {
  return (await import("../routes/$owner/$slug/security-audit")).Route as unknown as {
    __config: {
      component?: ComponentType;
    };
  };
}

describe("skill security audit route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue(undefined);
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
    useAuthStatusMock.mockReturnValue({ me: null });
    paramsMock = {
      owner: "local",
      slug: "local-agentic-risk-demo",
    };
    loaderDataMock = {
      owner: "local",
      displayName: "Local Agentic Risk Demo",
      summary: null,
      version: null,
      initialData: { result: undefined },
    };
  });

  it("renders a skeleton while security audit details are loading", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.queryByText("Loading security audit...")).toBeNull();
    const loadingRegion = screen.getByRole("status", { name: "Loading security audit" });
    expect(loadingRegion.getAttribute("aria-busy")).toBe("true");
    expect(document.querySelector(".security-scanner-skeleton")).toBeTruthy();
  });
});
