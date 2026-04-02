import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.VITE_CONVEX_URL = process.env.VITE_CONVEX_URL || "https://example.convex.cloud";

const fetchSkillPageDataMock = vi.fn();

vi.mock("../convex/client", () => ({
  convex: {},
  convexHttp: {},
}));

vi.mock("../components/SkillDetailPage", () => ({
  SkillDetailPage: () => null,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: {
      loader?: (args: { params: { owner: string; slug: string } }) => Promise<unknown>;
      component?: unknown;
      head?: unknown;
    }) => ({ __config: config }),
  redirect: (options: unknown) => ({ redirect: options }),
}));

vi.mock("../lib/skillPage", () => ({
  fetchSkillPageData: (...args: unknown[]) => fetchSkillPageDataMock(...args),
}));

async function loadRoute() {
  return (await import("../routes/$owner/$slug")).Route as unknown as {
    __config: {
      loader?: (args: { params: { owner: string; slug: string } }) => Promise<unknown>;
      head?: (args: {
        params: { owner: string; slug: string };
        loaderData?: {
          owner?: string | null;
          displayName?: string | null;
          summary?: string | null;
          version?: string | null;
        };
      }) => unknown;
    };
  };
}

async function runLoader(params: { owner: string; slug: string }) {
  const route = await loadRoute();
  const loader = route.__config.loader as (args: {
    params: { owner: string; slug: string };
  }) => Promise<unknown>;

  try {
    return await loader({ params });
  } catch (error) {
    return error;
  }
}

function runHead(
  params: { owner: string; slug: string },
  loaderData?: {
    owner?: string | null;
    displayName?: string | null;
    summary?: string | null;
    version?: string | null;
  },
) {
  return loadRoute().then((route) => route.__config.head?.({ params, loaderData }));
}

describe("skill route loader", () => {
  beforeEach(() => {
    fetchSkillPageDataMock.mockReset();
  });

  it("redirects to the canonical owner and slug from loader data", async () => {
    fetchSkillPageDataMock.mockResolvedValue({
      owner: "steipete",
      displayName: "Weather",
      summary: "Get current weather.",
      version: "1.0.0",
      initialData: {
        result: {
          resolvedSlug: "weather-pro",
          skill: {
            _id: "skills:1",
            slug: "weather-pro",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            tags: {},
            badges: {},
            stats: {},
            createdAt: 0,
            updatedAt: 0,
            _creationTime: 0,
          },
          latestVersion: null,
          owner: {
            _id: "users:1",
            _creationTime: 0,
            handle: "steipete",
            name: "Peter",
          },
          forkOf: null,
          canonical: null,
        },
        readme: "# Weather",
        readmeError: null,
      },
    });

    expect(await runLoader({ owner: "legacy-owner", slug: "weather" })).toEqual({
      redirect: {
        to: "/$owner/$slug",
        params: { owner: "steipete", slug: "weather-pro" },
        replace: true,
      },
    });
  });

  it("returns initial page data when the route is already canonical", async () => {
    fetchSkillPageDataMock.mockResolvedValue({
      owner: "steipete",
      displayName: "Weather",
      summary: "Get current weather.",
      version: "1.0.0",
      initialData: {
        result: {
          resolvedSlug: "weather",
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            tags: {},
            badges: {},
            stats: {},
            createdAt: 0,
            updatedAt: 0,
            _creationTime: 0,
          },
          latestVersion: null,
          owner: {
            _id: "users:1",
            _creationTime: 0,
            handle: "steipete",
            name: "Peter",
          },
          forkOf: null,
          canonical: null,
        },
        readme: "# Weather",
        readmeError: null,
      },
    });

    await expect(runLoader({ owner: "steipete", slug: "weather" })).resolves.toEqual({
      owner: "steipete",
      displayName: "Weather",
      summary: "Get current weather.",
      version: "1.0.0",
      initialData: expect.objectContaining({
        readme: "# Weather",
      }),
    });
  });

  it("does not redirect when canonical owner data is missing", async () => {
    fetchSkillPageDataMock.mockResolvedValue({
      owner: null,
      displayName: "Weather",
      summary: "Get current weather.",
      version: "1.0.0",
      initialData: {
        result: {
          resolvedSlug: "weather-pro",
          skill: {
            _id: "skills:1",
            slug: "weather-pro",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            tags: {},
            badges: {},
            stats: {},
            createdAt: 0,
            updatedAt: 0,
            _creationTime: 0,
          },
          latestVersion: null,
          owner: null,
          forkOf: null,
          canonical: null,
        },
        readme: "# Weather",
        readmeError: null,
      },
    });

    await expect(runLoader({ owner: "legacy-owner", slug: "weather" })).resolves.toEqual({
      owner: "legacy-owner",
      displayName: "Weather",
      summary: "Get current weather.",
      version: "1.0.0",
      initialData: expect.objectContaining({
        readme: "# Weather",
      }),
    });
  });

  it("falls back to params when loader data is empty", async () => {
    fetchSkillPageDataMock.mockResolvedValue({
      owner: null,
      displayName: null,
      summary: null,
      version: null,
      initialData: null,
    });

    await expect(runLoader({ owner: "steipete", slug: "weather" })).resolves.toEqual({
      owner: "steipete",
      displayName: null,
      summary: null,
      version: null,
      initialData: null,
    });
  });

  it("builds canonical and og metadata from loader data", async () => {
    const head = (await runHead(
      { owner: "legacy-owner", slug: "weather" },
      {
        owner: "steipete",
        displayName: "Weather",
        summary: "Get current weather.",
        version: "1.0.0",
      },
    )) as { links: Array<{ rel: string; href: string }>; meta?: unknown[] };

    expect(head).toEqual(
      expect.objectContaining({
        links: [
          {
            rel: "canonical",
            href: "https://clawhub.ai/steipete/weather",
          },
        ],
      }),
    );
    expect(head?.meta).toEqual(
      expect.arrayContaining([
        { title: "Weather — ClawHub" },
        { name: "description", content: "Get current weather." },
        { property: "og:url", content: "https://clawhub.ai/steipete/weather" },
        {
          property: "og:image",
          content: "https://clawhub.ai/og/skill.png?v=5&slug=weather&owner=steipete&version=1.0.0",
        },
        {
          name: "twitter:image",
          content: "https://clawhub.ai/og/skill.png?v=5&slug=weather&owner=steipete&version=1.0.0",
        },
      ]),
    );
  });

  it("falls back to route params when head loader data is absent", async () => {
    await expect(runHead({ owner: "steipete", slug: "weather" })).resolves.toEqual({
      links: [
        {
          rel: "canonical",
          href: "https://clawhub.ai/steipete/weather",
        },
      ],
      meta: expect.arrayContaining([
        { title: "weather — ClawHub" },
        { property: "og:url", content: "https://clawhub.ai/steipete/weather" },
      ]),
    });
  });
});
