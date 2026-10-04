import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { fetchSkillPageDataMock } = vi.hoisted(() => ({ fetchSkillPageDataMock: vi.fn() }));
vi.mock("../convex/client", () => ({ convex: {}, convexHttp: {} }));
vi.mock("../lib/skillPage", () => ({ fetchSkillPageData: fetchSkillPageDataMock }));
vi.mock("../components/SkillDetailPage", () => ({ SkillDetailPage: () => <h1>Loaded skill</h1> }));

import { Route } from "../routes/$owner/skills/$slug";

const data = {
  owner: "steipete",
  displayName: "Weather",
  summary: "Weather",
  version: "1.0.0",
  initialData: null,
};

describe("skill detail route pending state", () => {
  it("shows an accessible skill skeleton until the loader resolves", async () => {
    let resolveData!: (value: typeof data) => void;
    fetchSkillPageDataMock.mockReturnValue(
      new Promise<typeof data>((resolve) => {
        resolveData = resolve;
      }),
    );
    const root = createRootRoute({ component: Outlet });
    const route = createRoute({
      path: "/$owner/skills/$slug",
      getParentRoute: () => root,
      pendingComponent: Route.options.pendingComponent,
      loader: ({ params }) => fetchSkillPageDataMock(params.slug, params.owner),
      component: () => <h1>Loaded skill</h1>,
    });
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ["/steipete/skills/weather"] }),
      defaultPendingMs: 0,
      defaultPendingMinMs: 0,
    });
    render(<RouterProvider router={router} />);
    const status = await screen.findByRole("status", { name: "Loading skill details" });
    expect(status.querySelector(".detail-skeleton-skill")).not.toBeNull();
    expect(status.closest("main")?.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      resolveData(data);
    });
    await screen.findByRole("heading", { name: "Loaded skill" });
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "Loading skill details" })).toBeNull(),
    );
    expect(fetchSkillPageDataMock).toHaveBeenCalledWith("weather", "steipete");
  });
});
