/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeListingView } from "../lib/homeListingData";
const { fetchDiscovery, data, fetchListing, listing, listingComponent, navigate, routeSearch } =
  vi.hoisted(() => ({
    fetchDiscovery: vi.fn(),
    fetchListing: vi.fn(),
    listingComponent: vi.fn(),
    navigate: vi.fn(),
    routeSearch: { kind: "skills", tab: "new" },
    listing: {
      kind: "skills",
      tab: "new",
      items: [],
      hasMore: false,
      categorySlugs: [],
      fetchLimit: 20,
    },
    data: { items: [], featured: [] },
  }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: unknown) => ({
    __config: config,
    useSearch: () => routeSearch,
    useLoaderData: () => ({
      initialData: data,
      initialListing: listing,
      initialFeatureFlags: { values: { homepageTestMessage: false } },
    }),
  }),
  useNavigate: () => navigate,
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../lib/featureFlags", () => ({
  FeatureFlagProvider: ({ children }: { children: ReactNode }) => children,
  useFeatureFlag: () => false,
}));
vi.mock("../lib/featureFlags.functions", () => ({
  loadInitialFeatureFlags: async () => ({ values: { homepageTestMessage: false } }),
}));
vi.mock("../lib/clawDiscovery", () => ({ fetchClawDiscovery: fetchDiscovery }));
vi.mock("../components/ClawDiscovery", () => ({
  ClawSearch: () => <input aria-label="Search Claws" />,
  ClawDiscovery: () => <section data-testid="claw-discovery" />,
}));
vi.mock("../components/HomeListingSection", () => ({
  HomeListingSection: (props: unknown) => {
    listingComponent(props);
    return <section data-testid="tools-listing" />;
  },
}));
vi.mock("../components/HomePopularPublishersSection", () => ({
  HomePopularPublishersSection: () => <h2>Official creators</h2>,
}));
vi.mock("../components/HomeAppsSection", () => ({ HomeAppsSection: () => <section /> }));
vi.mock("../components/HomeBringSkillsSection", () => ({
  HomeBringSkillsSection: () => <h2>ClawHub CLI</h2>,
}));
vi.mock("../lib/homeListingData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/homeListingData")>()),
  fetchInitialHomeListing: (view: unknown) => fetchListing(view),
}));
import { Route } from "../routes/index";
const config = (
  Route as unknown as {
    __config: {
      component: React.ComponentType;
      loader: (ctx: { location: { search: Record<string, unknown> } }) => Promise<unknown>;
      validateSearch: (search: Record<string, unknown>) => unknown;
    };
  }
).__config;
describe("Claws homepage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchListing.mockResolvedValue(listing);
    fetchDiscovery.mockReset();
    fetchDiscovery.mockResolvedValue(data);
  });
  it("makes Claw discovery the primary experience and keeps tools, creators and publishing below it", () => {
    render(<config.component />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Find a Claw for the job." }),
    ).toBeTruthy();
    expect(screen.getByLabelText("Search Claws")).toBeTruthy();
    expect(
      screen
        .getByTestId("claw-discovery")
        .compareDocumentPosition(screen.getByRole("heading", { name: "Tools for your agents" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Official creators" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ClawHub CLI" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Publisher & CLI documentation" }).getAttribute("href"),
    ).toBe("https://docs.openclaw.ai/clawhub/");
  });
  it("loads the real Claw catalog", async () => {
    await expect(config.loader({ location: { search: routeSearch } })).resolves.toMatchObject({
      initialData: data,
    });
    expect(fetchDiscovery).toHaveBeenCalledOnce();
  });
  it("allows client recovery after a loader failure", async () => {
    fetchDiscovery.mockRejectedValueOnce(new Error("offline"));
    await expect(config.loader({ location: { search: routeSearch } })).resolves.toMatchObject({
      initialData: null,
    });
  });
});

describe("secondary tools URL state", () => {
  it("passes loader data and the URL view to the tools section", () => {
    render(<config.component />);
    expect(listingComponent).toHaveBeenCalledWith({
      initialListing: listing,
      requestedView: routeSearch,
      onViewChange: expect.any(Function),
    });
  });
  it("loads the requested tools view for direct links", async () => {
    await config.loader({ location: { search: { kind: "skills", tab: "official" } } });
    expect(fetchListing).toHaveBeenCalledWith({ kind: "skills", tab: "official" });
  });
  it("keeps defaults out of the URL and drops unknown values", () => {
    expect(config.validateSearch({ kind: "plugins", tab: "featured" })).toEqual({
      kind: undefined,
      tab: undefined,
    });
    expect(config.validateSearch({ kind: "agents", tab: ["new"] })).toEqual({
      kind: undefined,
      tab: undefined,
    });
  });
  it("replaces the tools view without scrolling", () => {
    render(<config.component />);
    const { onViewChange } = listingComponent.mock.calls.at(-1)![0] as {
      onViewChange: (view: HomeListingView) => void;
    };
    onViewChange({ kind: "plugins", tab: "new" });
    expect(navigate).toHaveBeenCalledWith({
      search: expect.any(Function),
      replace: true,
      resetScroll: false,
    });
    const { search } = navigate.mock.calls.at(-1)![0] as {
      search: (prev: Record<string, unknown>) => unknown;
    };
    expect(search(routeSearch)).toEqual({ kind: undefined, tab: "new" });
  });
});
