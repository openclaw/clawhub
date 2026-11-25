import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { SkillDetailPage } from "../components/SkillDetailPage";
import type { SkillPageInitialData } from "../lib/skillPage";
import { deferred } from "./helpers/deferred";

const navigateMock = vi.fn();
const routerInvalidateMock = vi.fn();
const useAuthStatusMock = vi.fn();

process.env.VITE_CONVEX_URL = process.env.VITE_CONVEX_URL ?? "https://example.convex.cloud";

vi.mock("../components/UserBadge", () => ({
  UserBadge: () => null,
}));

vi.mock("../convex/client", () => ({
  convex: {},
  convexHttp: { query: (...args: unknown[]) => convexQueryMock(...args) },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => children,
  useNavigate: () => navigateMock,
  useRouter: () => ({ invalidate: routerInvalidateMock }),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { searchStr: string } }) => string;
  }) => select({ location: { searchStr: "" } }),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: vi.fn() }),
}));

const useQueryMock = vi.fn();
const useQueriesMock = vi.fn((queries: Record<string, { query: unknown; args: unknown }>) =>
  Object.fromEntries(
    Object.entries(queries).map(([key, value]) => [key, useQueryMock(value.query, value.args)]),
  ),
);
const useMutationMock = vi.fn();
const convexQueryMock = vi.fn();
const convexClientMock = { query: convexQueryMock };
const getReadmeMock = vi.fn();
const getSkillCardMock = vi.fn();

function getReleaseTabs() {
  const dialog = screen.getByRole("dialog", { name: "Release details" });
  return within(within(dialog).getByRole("tablist", { name: "Skill detail tabs" }));
}

function setInitialHash(hash: string) {
  window.history.replaceState(null, "", window.location.pathname + window.location.search + hash);
}

function openReleaseDetails(version?: string) {
  fireEvent.click(
    screen.getByRole("button", { name: version ? `View release ${version}` : "View files" }),
  );
  return within(screen.getByRole("dialog", { name: "Release details" }));
}

vi.mock("convex/react", () => ({
  ConvexReactClient: class {},
  useConvex: () => convexClientMock,
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueries: (queries: Record<string, { query: unknown; args: unknown }>) =>
    useQueriesMock(queries),
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: vi.fn(),
  }),
  useAction: (fn: never) =>
    getFunctionName(fn) === "skills:getSkillCard" ? getSkillCardMock : getReadmeMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../lib/useAuthStatus", () => ({
  useAuthStatus: () => useAuthStatusMock(),
}));

vi.mock("../components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { children: ReactNode }) => children,
}));

describe("SkillDetailPage", () => {
  const skillId = "skills:1" as Id<"skills">;
  const ownerId = "users:1" as Id<"users">;
  const ownerPublisherId = "publishers:steipete" as Id<"publishers">;
  const versionId = "skillVersions:1" as Id<"skillVersions">;
  const storageId = "storage:1" as Id<"_storage">;

  function makeMinimalWeatherSkill(overrides: Record<string, unknown> = {}) {
    return {
      _id: skillId,
      slug: "weather",
      displayName: "Weather",
      summary: "Get current weather.",
      ownerUserId: ownerId,
      ownerPublisherId,
      tags: {},
      stats: { stars: 0, downloads: 0 },
      ...overrides,
    };
  }

  function makeWeatherPublisher(overrides: Record<string, unknown> = {}) {
    return {
      _id: ownerPublisherId,
      _creationTime: 0,
      kind: "user" as const,
      handle: "steipete",
      displayName: "Peter",
      linkedUserId: ownerId,
      ...overrides,
    };
  }

  function makeWeatherVersion(overrides: Partial<Doc<"skillVersions">> = {}): Doc<"skillVersions"> {
    return {
      _id: versionId,
      _creationTime: 0,
      skillId,
      version: "1.0.0",
      fingerprint: "abc",
      changelog: "Initial release",
      parsed: { license: "MIT-0", frontmatter: {} },
      files: [],
      createdBy: ownerId,
      createdAt: 0,
      ...overrides,
    };
  }

  function makeMinimalWeatherSkillResult() {
    return {
      skill: makeMinimalWeatherSkill(),
      owner: makeWeatherPublisher(),
      latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
    };
  }

  function makeWeatherSkill(overrides: Record<string, unknown> = {}) {
    return {
      _id: skillId,
      _creationTime: 0,
      slug: "weather",
      displayName: "Weather",
      summary: "Get current weather.",
      ownerUserId: ownerId,
      ownerPublisherId,
      tags: {},
      badges: {},
      stats: {
        stars: 12,
        downloads: 34,
        installs: 8,
        versions: 1,
        comments: 0,
      },
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    };
  }

  function makeWeatherSkillResult() {
    return {
      skill: makeWeatherSkill(),
      owner: makeWeatherPublisher(),
      latestVersion: makeWeatherVersion({
        files: [
          {
            path: "SKILL.md",
            size: 10,
            storageId,
            sha256: "abc",
            contentType: "text/markdown",
          },
        ],
      }),
      forkOf: null,
      canonical: null,
    } satisfies NonNullable<SkillPageInitialData["result"]>;
  }

  function makeInitialData(githubBacked = false): SkillPageInitialData {
    return {
      result: {
        skill: {
          _id: skillId,
          _creationTime: 0,
          slug: githubBacked ? "github-skill" : "weather",
          displayName: githubBacked ? "GitHub Skill" : "Weather",
          summary: githubBacked ? "Loaded from GitHub." : "Get current weather.",
          ownerUserId: ownerId,
          ownerPublisherId,
          ...(githubBacked ? { installKind: "github" as const } : {}),
          tags: {},
          badges: {},
          stats: { stars: 0, downloads: 0, installs: 0, versions: 2, comments: 0 },
          createdAt: 0,
          updatedAt: 0,
        },
        owner: null,
        latestVersion: githubBacked
          ? null
          : makeWeatherVersion({
              version: "2.0.0",
              changelog: "Current release",
              parsed: { frontmatter: {} },
            }),
        forkOf: null,
        canonical: null,
      },
      readme: githubBacked ? null : "# Weather",
      readmeError: null,
    };
  }

  beforeEach(() => {
    setInitialHash("");
    useQueryMock.mockReset();
    useQueriesMock.mockClear();
    useMutationMock.mockReset();
    convexQueryMock.mockReset();
    getReadmeMock.mockReset();
    getSkillCardMock.mockReset();
    getSkillCardMock.mockImplementation((args) => getReadmeMock(args));
    navigateMock.mockReset();
    routerInvalidateMock.mockReset();
    useAuthStatusMock.mockReset();
    getReadmeMock.mockResolvedValue({ text: "" });
    useMutationMock.mockReturnValue(vi.fn());
    vi.mocked(toast.success).mockReset();
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
      me: null,
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });
    convexQueryMock.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the verified card and current release notes before opening release details", async () => {
    const initialData = makeInitialData();
    initialData.result!.latestVersion = makeWeatherVersion({
      changelog: "New release notes.",
      generatedSkillCard: { path: "skill-card.md", size: 20, storageId, sha256: "card" },
    } as Partial<Doc<"skillVersions">>);
    getSkillCardMock.mockResolvedValue({ text: "## Description:\n\nGenerated release summary." });
    render(<SkillDetailPage slug="weather" initialData={initialData} />);
    expect(await screen.findByRole("heading", { name: "Skill card" })).toBeTruthy();
    const well = document.querySelector(".skill-catalog-well");
    expect(well?.textContent).toContain("Generated release summary.");
    expect(screen.getByRole("heading", { name: "Latest: v1.0.0" })).toBeTruthy();
    expect(screen.getByText("New release notes.")).toBeTruthy();
    expect(screen.queryByText("Package contents")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Release details" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Skill detail tabs" })).toBeNull();
    const release = openReleaseDetails("1.0.0");
    expect(release.getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(release.getByRole("tab", { name: "Versions" })).toBeTruthy();
    fireEvent.click(release.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Release details" })).toBeNull();
    expect(getSkillCardMock).toHaveBeenCalledExactlyOnceWith({ versionId });
  });

  it.each(["#card", "#skill-card"])("opens the generated card alias %s", async (hash) => {
    setInitialHash(hash);
    getSkillCardMock.mockResolvedValue({ text: "# Generated card" });
    const initialData = makeInitialData();
    initialData.result!.latestVersion = makeWeatherVersion({
      generatedSkillCard: { path: "skill-card.md", size: 20, storageId, sha256: "card" },
    } as Partial<Doc<"skillVersions">>);
    render(<SkillDetailPage slug="weather" initialData={initialData} />);
    await waitFor(() =>
      expect(
        getReleaseTabs().getByRole("tab", { name: "Skill Card" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(
      await within(screen.getByRole("tabpanel", { name: "Skill Card" })).findByRole("heading", {
        name: "Generated card",
      }),
    ).toBeTruthy();
  });

  it.each(["#diff", "#compare"])(
    "opens comparison alias %s only once versions make it available",
    async (hash) => {
      setInitialHash(hash);
      let releases: Doc<"skillVersions">[] | undefined;
      useQueryMock.mockImplementation((query: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        return getFunctionName(query as never) === "skills:listVersions" ? releases : undefined;
      });
      const initialData = makeInitialData();
      const { rerender } = render(<SkillDetailPage slug="weather" initialData={initialData} />);
      expect(getReleaseTabs().queryByRole("tab", { name: "Diff" })).toBeNull();
      releases = [
        makeWeatherVersion(),
        makeWeatherVersion({ _id: "skillVersions:2" as Id<"skillVersions"> }),
      ];
      rerender(<SkillDetailPage slug="weather" initialData={initialData} />);
      await waitFor(() =>
        expect(
          getReleaseTabs().getByRole("tab", { name: "Diff" }).getAttribute("aria-selected"),
        ).toBe("true"),
      );
    },
  );

  it("ignores an unknown hash and opens on README from the release button", () => {
    setInitialHash("#unknown");
    render(<SkillDetailPage slug="weather" initialData={makeInitialData()} />);
    expect(screen.queryByRole("dialog", { name: "Release details" })).toBeNull();
    const release = openReleaseDetails("2.0.0");
    expect(release.getByRole("tab", { name: "SKILL.md", selected: true })).toBeTruthy();
  });

  it.each([
    ["#files", "Files"],
    ["#versions", "Versions"],
  ])("opens release details on the %s deep link", (hash, tabName) => {
    setInitialHash(hash);
    render(<SkillDetailPage slug="weather" initialData={makeInitialData()} />);
    expect(getReleaseTabs().getByRole("tab", { name: tabName, selected: true })).toBeTruthy();
  });

  it("opens release details on a hash change and clears the hash when dismissed", () => {
    render(<SkillDetailPage slug="weather" initialData={makeInitialData()} />);
    expect(screen.queryByRole("dialog", { name: "Release details" })).toBeNull();
    setInitialHash("#files");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(getReleaseTabs().getByRole("tab", { name: "Files", selected: true })).toBeTruthy();
    const release = within(screen.getByRole("dialog", { name: "Release details" }));
    fireEvent.click(release.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Release details" })).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it.each(["#runtime", "#skill-card"])("keeps unavailable hash %s on README", (hash) => {
    setInitialHash(hash);
    render(<SkillDetailPage slug="weather" initialData={makeInitialData()} />);
    expect(
      getReleaseTabs().getByRole("tab", { name: "SKILL.md" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("shows a loading indicator while loading", () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);
    expect(screen.getByRole("status", { name: /Loading skill details/i })).toBeTruthy();
    expect(screen.queryByText(/Skill not found/i)).toBeNull();
  });

  it("renders loader-backed skill content before live queries resolve", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: makeWeatherSkillResult(),
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect(screen.queryByText(/Loading skill/i)).toBeNull();
    expect((await screen.findAllByRole("heading", { name: "Weather" })).length).toBeGreaterThan(0);
    expect(screen.getByText(/Get current weather\./i)).toBeTruthy();
    const release = openReleaseDetails("1.0.0");
    expect(release.getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(release.queryByRole("tab", { name: "Diff" })).toBeNull();
  });

  it("bounds version eligibility reads and loads full history only in Versions", async () => {
    useQueryMock.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        getFunctionName(query as never) === "skills:listVersions" &&
        args &&
        typeof args === "object" &&
        "limit" in args &&
        args.limit === 2
      ) {
        return [
          { _id: "skillVersions:1", version: "2.0.0", files: [] },
          { _id: "skillVersions:2", version: "1.0.0", files: [] },
        ];
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" initialData={makeInitialData()} />);

    expect(
      useQueryMock.mock.calls.some(
        ([query, args]) =>
          getFunctionName(query as never) === "skills:listVersions" &&
          args &&
          typeof args === "object" &&
          "limit" in args &&
          args.limit === 2,
      ),
    ).toBe(true);
    expect(
      useQueryMock.mock.calls.some(
        ([query, args]) =>
          getFunctionName(query as never) === "skills:listVersions" &&
          args &&
          typeof args === "object" &&
          "limit" in args &&
          args.limit === 50,
      ),
    ).toBe(false);

    const release = openReleaseDetails("2.0.0");
    fireEvent.click(release.getByRole("tab", { name: "Versions" }));

    await waitFor(() =>
      expect(
        useQueryMock.mock.calls.some(
          ([query, args]) =>
            getFunctionName(query as never) === "skills:listVersions" &&
            args &&
            typeof args === "object" &&
            "limit" in args &&
            args.limit === 50,
        ),
      ).toBe(true),
    );
  });

  it("skips archive version reads for GitHub-backed skills", () => {
    render(<SkillDetailPage slug="github-skill" initialData={makeInitialData(true)} />);

    const versionCalls = useQueryMock.mock.calls.filter(
      ([query]) => getFunctionName(query as never) === "skills:listVersions",
    );
    expect(versionCalls.length).toBeGreaterThan(0);
    expect(versionCalls.every(([, args]) => args === "skip")).toBe(true);
  });

  it("shows Evals only for a completed result on the current NVIDIA version", () => {
    useQueryMock.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (getFunctionName(query as never) === "skillEvaluations:getCurrentForSkill") {
        return {
          source: {
            repository: "nvidia/skills",
            commit: "0a78f333a1d67c837fbf4288efe6488169dc7140",
            path: "skills/doca-dpa",
            contentHash: "content-hash",
          },
          evaluator: {
            repository: "NVIDIA/SkillEvaluator",
            release: "v0.1.0",
            commit: "4975c97d49e3623eeab739248e52d83c4aa8f582",
            agent: "codex",
            agentModel: "gpt-5.4-mini",
            judgeProvider: "openai",
            judgeModel: "gpt-5.4",
            environment: "docker",
            attempts: 2,
          },
          metrics: {
            sampleCount: 8,
            overall: { withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
            cases: {
              withSkillPassed: 4,
              withSkillTotal: 4,
              withoutSkillPassed: 2,
              withoutSkillTotal: 4,
            },
            dimensions: [
              { id: "security", withSkill: 1, withoutSkill: 1, delta: 0 },
              { id: "correctness", withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
            ],
          },
          completedAt: Date.parse("2026-08-18T00:00:00Z"),
        };
      }
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: skillId,
            _creationTime: 0,
            slug: "doca-dpa",
            displayName: "DOCA DPA",
            summary: "Build NVIDIA DOCA DPA applications.",
            ownerUserId: ownerId,
            ownerPublisherId,
            installKind: "github",
            githubCurrentRepo: "NVIDIA/skills",
            githubCurrentCommit: "0a78f333a1d67c837fbf4288efe6488169dc7140",
            githubPath: "skills/doca-dpa",
            tags: {},
            badges: {},
            stats: { stars: 0, downloads: 0, installs: 0, versions: 0, comments: 0 },
            createdAt: 0,
            updatedAt: 0,
          },
          owner: makeWeatherPublisher({
            handle: "nvidia",
            displayName: "NVIDIA",
          }),
          latestVersion: null,
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="doca-dpa" canonicalOwner="nvidia" />);

    openReleaseDetails();
    expect(getReleaseTabs().getByRole("tab", { name: "Evals" })).toBeTruthy();
  });

  it("looks up Evals from the canonical skill when detail data uses a projected id", () => {
    useQueryMock.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (getFunctionName(query as never) === "skillEvaluations:getCurrentForSkill") {
        return {
          source: {
            repository: "nvidia/skills",
            commit: "0a78f333a1d67c837fbf4288efe6488169dc7140",
            path: "skills/doca-dpa",
            contentHash: "content-hash",
          },
          evaluator: {
            repository: "NVIDIA/SkillEvaluator",
            release: "v0.1.0",
            commit: "4975c97d49e3623eeab739248e52d83c4aa8f582",
            agent: "codex",
            agentModel: "gpt-5.4-mini",
            judgeProvider: "openai",
            judgeModel: "gpt-5.4",
            environment: "docker",
            attempts: 2,
          },
          metrics: {
            sampleCount: 8,
            overall: { withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
            cases: {
              withSkillPassed: 4,
              withSkillTotal: 4,
              withoutSkillPassed: 2,
              withoutSkillTotal: 4,
            },
            dimensions: [],
          },
          completedAt: Date.parse("2026-08-18T00:00:00Z"),
        };
      }
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="doca-dpa"
        canonicalOwner="nvidia"
        initialData={{
          result: {
            skill: {
              _id: "canonicalTrendingNativePools:doca-dpa" as Id<"skills">,
              _creationTime: 0,
              slug: "doca-dpa",
              displayName: "DOCA DPA",
              summary: "Build NVIDIA DOCA DPA applications.",
              ownerUserId: ownerId,
              ownerPublisherId,
              installKind: "github",
              githubSourceRepo: "NVIDIA/skills",
              githubPath: "skills/doca-dpa",
              tags: {},
              badges: {},
              stats: { stars: 0, downloads: 0, installs: 0, versions: 0, comments: 0 },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: null,
            latestVersion: null,
            forkOf: null,
            canonical: null,
          },
          readme: null,
          readmeError: null,
        }}
      />,
    );

    openReleaseDetails();
    expect(useQueryMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skillId: "canonicalTrendingNativePools:doca-dpa",
        sourceRepo: "NVIDIA/skills",
        sourcePath: "skills/doca-dpa",
      }),
    );
    expect(getReleaseTabs().getByRole("tab", { name: "Evals" })).toBeTruthy();
  });

  it("hides Evals when the current skill version has no completed result", () => {
    render(<SkillDetailPage slug="github-skill" initialData={makeInitialData(true)} />);

    openReleaseDetails();
    expect(getReleaseTabs().queryByRole("tab", { name: "Evals" })).toBeNull();
  });

  it("hides Evals when the optional evaluation query fails", () => {
    useQueriesMock.mockReturnValueOnce({ skillEvaluation: new Error("evaluation unavailable") });

    render(<SkillDetailPage slug="github-skill" initialData={makeInitialData(true)} />);

    openReleaseDetails();
    expect(getReleaseTabs().queryByRole("tab", { name: "Evals" })).toBeNull();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });

  it("opens an evaluation deep link after its result finishes loading", async () => {
    setInitialHash("#evaluation");
    let evaluationResult: Record<string, unknown> | undefined;
    useQueryMock.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (getFunctionName(query as never) === "skillEvaluations:getCurrentForSkill") {
        return evaluationResult;
      }
      return undefined;
    });
    const initialData = makeInitialData(true);
    const { rerender } = render(<SkillDetailPage slug="github-skill" initialData={initialData} />);

    expect(getReleaseTabs().queryByRole("tab", { name: "Evals" })).toBeNull();

    evaluationResult = {
      source: {
        repository: "nvidia/skills",
        commit: "0a78f333a1d67c837fbf4288efe6488169dc7140",
        path: "skills/doca-dpa",
        contentHash: "content-hash",
      },
      evaluator: {
        repository: "NVIDIA/SkillEvaluator",
        release: "v0.1.0",
        commit: "4975c97d49e3623eeab739248e52d83c4aa8f582",
        agent: "codex",
        agentModel: "gpt-5.4-mini",
        judgeProvider: "openai",
        judgeModel: "gpt-5.4",
        environment: "docker",
        attempts: 2,
      },
      metrics: {
        sampleCount: 8,
        overall: { withSkill: 0.9, withoutSkill: 0.6, delta: 0.3 },
        cases: {
          withSkillPassed: 4,
          withSkillTotal: 4,
          withoutSkillPassed: 2,
          withoutSkillTotal: 4,
        },
        dimensions: [],
      },
      completedAt: Date.parse("2026-08-18T00:00:00Z"),
    };
    rerender(<SkillDetailPage slug="github-skill" initialData={initialData} />);

    await waitFor(() =>
      expect(
        getReleaseTabs().getByRole("tab", { name: "Evals" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(screen.getByRole("tabpanel", { name: "Evals" })).toBeTruthy();
  });

  it("keeps loader-backed skill content visible while staff live query resolves", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:staff", role: "moderator" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="github"
        canonicalOwner="steipete"
        initialData={{
          result: {
            skill: makeWeatherSkill({
              slug: "github",
              displayName: "Github",
              summary: "Interact with GitHub using the `gh` CLI.",
            }),
            owner: makeWeatherPublisher(),
            latestVersion: makeWeatherVersion({
              files: [
                {
                  path: "SKILL.md",
                  size: 10,
                  storageId,
                  sha256: "abc",
                  contentType: "text/markdown",
                },
              ],
            }),
            forkOf: null,
            canonical: null,
          },
          readme: "# GitHub Skill",
          readmeError: null,
        }}
      />,
    );

    expect(screen.queryByRole("status", { name: /Loading skill details/i })).toBeNull();
    expect(screen.getAllByRole("heading", { name: "Github" }).length).toBeGreaterThan(0);
    const summary = document.querySelector(".catalog-detail__summary");
    expect(summary?.textContent).toBe("Interact with GitHub using the gh CLI.");
    expect(summary?.querySelector("code.skill-summary-inline-code")?.textContent).toBe("gh");
  });

  it("loads skill activity graphs through a deferred one-shot query", async () => {
    const activityTrend = {
      installs: {
        range: "daily" as const,
        days: 30,
        total: 5,
        points: [
          { day: 20_451, value: 1 },
          { day: 20_452, value: 0 },
          { day: 20_453, value: 2 },
          { day: 20_454, value: 1 },
          { day: 20_455, value: 1 },
        ],
      },
      downloads: {
        range: "daily" as const,
        days: 30,
        total: 12,
        points: [
          { day: 20_451, value: 1 },
          { day: 20_452, value: 0 },
          { day: 20_453, value: 4 },
          { day: 20_454, value: 3 },
          { day: 20_455, value: 4 },
        ],
      },
    };
    const initialData = {
      result: makeWeatherSkillResult(),
      readme: "# Weather",
      readmeError: null,
    };
    const response = deferred<typeof activityTrend>();
    convexQueryMock.mockReturnValueOnce(response.promise);

    const { rerender } = render(<SkillDetailPage slug="weather" initialData={initialData} />);

    const release = openReleaseDetails("1.0.0");
    const dialog = screen.getByRole("dialog", { name: "Release details" });
    expect(release.getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(release.getByText("Downloads")).toBeTruthy();
    expect(release.queryByText("30-day Installs")).toBeNull();
    expect(dialog.querySelector(".metric-trend-card-skeleton")).toBeNull();
    expect(release.getByText("All time")).toBeTruthy();
    expect(release.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
    expect(
      useQueryMock.mock.calls.some(
        ([query]) => getFunctionName(query as never) === "skills:getActivityTrendForSlug",
      ),
    ).toBe(false);

    await waitFor(() => expect(convexQueryMock).toHaveBeenCalled());
    await act(async () => {
      response.resolve(activityTrend);
      await response.promise;
    });
    rerender(<SkillDetailPage slug="weather" initialData={initialData} />);

    expect(release.queryByRole("img", { name: "Daily installs over the last 30 days" })).toBeNull();
    expect(
      release.getByRole("img", { name: "Daily downloads over the last 30 days" }),
    ).toBeTruthy();
    expect(dialog.querySelector(".metric-trend-card-skeleton")).toBeNull();
    expect(
      convexQueryMock.mock.calls.some((call) => {
        const query = call[0];
        const args = call[1];
        return (
          getFunctionName(query as never) === "skills:getActivityTrendForSlug" &&
          typeof args === "object" &&
          args !== null &&
          "slug" in args &&
          args.slug === "weather" &&
          "endDay" in args &&
          typeof args.endDay === "number" &&
          "ownerHandle" in args &&
          args.ownerHandle === "steipete"
        );
      }),
    ).toBe(true);
  });

  it("passes the loader owner id to deferred activity trends when no public owner handle is available", async () => {
    const initialData = {
      result: {
        ...makeWeatherSkillResult(),
        owner: null,
      },
      readme: "# Weather",
      readmeError: null,
      lookupOwnerHandle: "users:1",
    };

    render(<SkillDetailPage slug="weather" canonicalOwner="users:1" initialData={initialData} />);

    await waitFor(() => expect(convexQueryMock).toHaveBeenCalled());

    expect(
      convexQueryMock.mock.calls.some((call) => {
        const query = call[0];
        const args = call[1];
        return (
          getFunctionName(query as never) === "skills:getActivityTrendForSlug" &&
          typeof args === "object" &&
          args !== null &&
          "slug" in args &&
          args.slug === "weather" &&
          "endDay" in args &&
          typeof args.endDay === "number" &&
          "ownerHandle" in args &&
          args.ownerHandle === "users:1"
        );
      }),
    ).toBe(true);
  });

  it("does not spin forever when a source-backed skill has no stored version", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "kind" in args) return null;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="aiq-deploy"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "aiq-deploy",
              displayName: "AIQ Deploy",
              summary: "Deploy AgentIQ workflows.",
              ownerUserId: ownerId,
              ownerPublisherId,
              installKind: "github",
              githubScanStatus: "pending",
              tags: {},
              badges: {},
              stats: {
                stars: 0,
                downloads: 0,
                installs: 0,
                versions: 0,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "org",
              handle: "local",
              displayName: "Local Dev",
            },
            latestVersion: null,
            moderationInfo: null,
            forkOf: null,
            canonical: null,
          },
          readme: null,
          readmeError: null,
        }}
      />,
    );

    expect((await screen.findAllByText("Pending")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Security check").length).toBeGreaterThan(0);
    openReleaseDetails();
    expect(screen.queryByText("Loading README...")).toBeNull();
  });

  describe("README request ownership", () => {
    beforeEach(() => {
      setInitialHash("#readme");
    });

    it.each([
      { name: "text", readme: "# Existing README", readmeError: null },
      { name: "empty text", readme: "", readmeError: null },
      { name: "error", readme: null, readmeError: "Stored README failure" },
    ])("reuses SSR $name without another request", ({ readme, readmeError }) => {
      const data = { ...makeInitialData(), readme, readmeError };
      const { rerender } = render(<SkillDetailPage slug="weather" initialData={data} />);
      rerender(<SkillDetailPage slug="weather" initialData={{ ...data }} />);
      expect(getReadmeMock).not.toHaveBeenCalled();
    });

    it("starts one request when a live version arrives without SSR data", () => {
      let result: SkillPageInitialData["result"] | undefined;
      useQueryMock.mockImplementation((_fn: unknown, args: unknown) =>
        args && typeof args === "object" && "slug" in args ? result : undefined,
      );
      const pending = deferred<{ text: string }>();
      getReadmeMock.mockReturnValue(pending.promise);
      const { rerender } = render(<SkillDetailPage slug="weather" />);
      result = makeInitialData().result;
      rerender(<SkillDetailPage slug="weather" />);
      expect(getReadmeMock).toHaveBeenCalledExactlyOnceWith({ versionId });
    });

    it("publishes the first request after a live version arrives", async () => {
      let result: SkillPageInitialData["result"] | undefined;
      useQueryMock.mockImplementation((_fn: unknown, args: unknown) =>
        args && typeof args === "object" && "slug" in args ? result : undefined,
      );
      const first = deferred<{ text: string }>();
      const unexpected = deferred<{ text: string }>();
      getReadmeMock.mockReturnValue(unexpected.promise).mockReturnValueOnce(first.promise);
      const { rerender } = render(<SkillDetailPage slug="weather" />);
      result = makeInitialData().result;
      rerender(<SkillDetailPage slug="weather" />);
      await act(async () => {
        first.resolve({ text: "# First live README\n\nThe first request completed." });
        await first.promise;
      });
      expect(await screen.findByText("The first request completed.")).toBeTruthy();
    });

    it("keeps the same pending request across equivalent skill snapshots", async () => {
      const data = { ...makeInitialData(), readme: null };
      const first = deferred<{ text: string }>();
      getReadmeMock.mockReturnValue(first.promise);
      const { rerender } = render(<SkillDetailPage slug="weather" initialData={data} />);
      if (!data.result) throw new Error("Missing skill fixture");
      rerender(
        <SkillDetailPage
          slug="weather"
          initialData={{
            ...data,
            result: { ...data.result, skill: { ...data.result.skill } },
          }}
        />,
      );
      expect(getReadmeMock).toHaveBeenCalledExactlyOnceWith({ versionId });
      await act(async () => {
        first.resolve({ text: "# Unchanged version\n\nSame request result." });
        await first.promise;
      });
      expect(await screen.findByText("Same request result.")).toBeTruthy();
    });

    it.each(["success", "failure"])(
      "ignores a stale %s after the selected version changes",
      async (settlement) => {
        const data = { ...makeInitialData(), readme: null };
        if (!data.result?.latestVersion) throw new Error("Missing version fixture");
        const nextVersionId = "skillVersions:2" as Id<"skillVersions">;
        const oldRead = deferred<{ text: string }>();
        const newRead = deferred<{ text: string }>();
        getReadmeMock.mockImplementation(({ versionId: requestedId }) =>
          requestedId === versionId ? oldRead.promise : newRead.promise,
        );
        const { rerender } = render(<SkillDetailPage slug="weather" initialData={data} />);
        rerender(
          <SkillDetailPage
            slug="weather"
            initialData={{
              ...data,
              result: {
                ...data.result,
                latestVersion: { ...data.result.latestVersion, _id: nextVersionId },
              },
            }}
          />,
        );
        await act(async () => {
          newRead.resolve({ text: "# Current README\n\nCurrent version content." });
          await newRead.promise;
        });
        expect(await screen.findByText("Current version content.")).toBeTruthy();
        await act(async () => {
          if (settlement === "success") oldRead.resolve({ text: "# Stale README" });
          else oldRead.reject(new Error("Stale README failure"));
          await oldRead.promise.catch(() => undefined);
        });
        expect(screen.getByText("Current version content.")).toBeTruthy();
        expect(screen.queryByText("Stale README")).toBeNull();
        expect(screen.queryByText("No README available")).toBeNull();
      },
    );

    it("retires a pending request when the next skill has no stored version", async () => {
      const data = { ...makeInitialData(), readme: null };
      if (!data.result) throw new Error("Missing skill fixture");
      const pending = deferred<{ text: string }>();
      getReadmeMock.mockReturnValue(pending.promise);
      const { rerender } = render(<SkillDetailPage slug="weather" initialData={data} />);
      rerender(
        <SkillDetailPage
          slug="empty-skill"
          initialData={{
            ...data,
            result: {
              ...data.result,
              skill: { ...data.result.skill, slug: "empty-skill" },
              latestVersion: null,
            },
          }}
        />,
      );
      expect(await screen.findByText("No README available")).toBeTruthy();
      await act(async () => {
        pending.resolve({ text: "# Retired README" });
        await pending.promise;
      });
      expect(screen.queryByText("Retired README")).toBeNull();
      expect(getReadmeMock).toHaveBeenCalledOnce();
    });
  });

  it("clears stale README content when navigating to a skill with no stored version", async () => {
    setInitialHash("#readme");
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    const { rerender } = render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: makeWeatherSkillResult(),
          readme: "# Weather\n\nOnly old body.",
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByText("Only old body.")).toBeTruthy();

    rerender(
      <SkillDetailPage
        slug="aiq-deploy"
        initialData={{
          result: {
            skill: makeWeatherSkill({
              slug: "aiq-deploy",
              displayName: "AIQ Deploy",
              summary: "Deploy AgentIQ workflows.",
              stats: {
                stars: 0,
                downloads: 0,
                installs: 0,
                versions: 0,
                comments: 0,
              },
            }),
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "org",
              handle: "local",
              displayName: "Local Dev",
            },
            latestVersion: null,
            moderationInfo: null,
            forkOf: null,
            canonical: null,
          },
          readme: null,
          readmeError: null,
        }}
      />,
    );

    expect(await screen.findByText("No README available")).toBeTruthy();
    expect(screen.queryByText("Only old body.")).toBeNull();
  });

  it("renders GitHub-backed SKILL.md and skill-card.md from cached source content", async () => {
    getReadmeMock.mockResolvedValue({ text: "unexpected archive read" });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "kind" in args &&
        (args as { kind?: unknown }).kind === "readme"
      ) {
        return { path: "skills/aiq-deploy/SKILL.md", text: "# AIQ Deploy\n\nDeploy it." };
      }
      if (
        args &&
        typeof args === "object" &&
        "kind" in args &&
        (args as { kind?: unknown }).kind === "skill-card"
      ) {
        return { path: "skills/aiq-deploy/skill-card.md", text: "# AIQ Card\n\nRisk details." };
      }
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="aiq-deploy"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "aiq-deploy",
              displayName: "AIQ Deploy",
              summary: "Deploy AgentIQ workflows.",
              ownerUserId: ownerId,
              ownerPublisherId,
              installKind: "github",
              githubHasSkillCard: true,
              tags: {},
              badges: {},
              stats: {
                stars: 0,
                downloads: 0,
                installs: 0,
                versions: 0,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: {
              _id: ownerPublisherId,
              _creationTime: 0,
              kind: "org",
              handle: "local",
              displayName: "Local Dev",
            },
            latestVersion: null,
            moderationInfo: null,
            forkOf: null,
            canonical: null,
          },
          readme: null,
          readmeError: null,
        }}
      />,
    );

    openReleaseDetails();
    expect(await screen.findByText("Deploy it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Skill Card" }));
    expect(
      await within(screen.getByRole("tabpanel", { name: "Skill Card" })).findByText(
        "Risk details.",
      ),
    ).toBeTruthy();
    expect(getReadmeMock).not.toHaveBeenCalled();
  });

  it("does not show a Skill Card tab for publisher-supplied card files", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: {
            skill: makeWeatherSkill(),
            owner: makeWeatherPublisher(),
            latestVersion: makeWeatherVersion({
              files: [
                {
                  path: "SKILL.md",
                  size: 10,
                  storageId,
                  sha256: "abc",
                  contentType: "text/markdown",
                },
                {
                  path: "skill-card.md",
                  size: 10,
                  storageId,
                  sha256: "def",
                  contentType: "text/markdown",
                },
              ],
            }),
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    openReleaseDetails("1.0.0");
    expect(await screen.findByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Skill Card" })).toBeNull();
  });

  it("restores the hash-selected Skill Card tab once the generated card is available", async () => {
    window.history.replaceState(null, "", "/steipete/weather#skill-card");
    getReadmeMock.mockResolvedValue({ text: "# Skill Card\n\nGenerated from worker." });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    const baseInitialData = {
      result: makeWeatherSkillResult(),
      readme: "# Weather",
      readmeError: null,
    };

    const { rerender } = render(<SkillDetailPage slug="weather" initialData={baseInitialData} />);

    expect(await screen.findByRole("tab", { name: "Files" })).toBeTruthy();
    expect(
      getReleaseTabs().getByRole("tab", { name: "SKILL.md" }).getAttribute("aria-selected"),
    ).toBe("true");

    rerender(
      <SkillDetailPage
        slug="weather"
        initialData={{
          ...baseInitialData,
          result: {
            ...baseInitialData.result,
            latestVersion: {
              ...baseInitialData.result.latestVersion,
              files: [
                ...baseInitialData.result.latestVersion.files,
                {
                  path: "skill-card.md",
                  size: 32,
                  storageId,
                  sha256: "def",
                  contentType: "text/markdown",
                },
              ],
              generatedSkillCard: {
                path: "skill-card.md",
                size: 32,
                sha256: "def",
                contentType: "text/markdown",
              },
            },
          },
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Skill Card" }).getAttribute("aria-selected")).toBe(
        "true",
      );
    });
    expect(
      await within(screen.getByRole("tabpanel", { name: "Skill Card" })).findByText(
        "Generated from worker.",
      ),
    ).toBeTruthy();
  });

  it("keeps one generated card request pending across loading-state and parent renders", async () => {
    const data = makeInitialData();
    if (!data.result?.latestVersion) throw new Error("Missing version fixture");
    const card = {
      path: "skill-card.md",
      size: 32,
      storageId,
      sha256: "generated-card",
      contentType: "text/markdown",
    };
    data.result.latestVersion.files = [card];
    data.result.latestVersion.generatedSkillCard = card;
    const pending = deferred<{ text: string }>();
    getSkillCardMock.mockReturnValue(pending.promise);

    const { rerender } = render(<SkillDetailPage slug="weather" initialData={data} />);
    rerender(<SkillDetailPage slug="weather" initialData={{ ...data }} />);
    expect(getSkillCardMock).toHaveBeenCalledExactlyOnceWith({ versionId });

    openReleaseDetails("2.0.0");
    fireEvent.click(screen.getByRole("tab", { name: "Skill Card" }));
    await act(async () => {
      pending.resolve({ text: "# Skill Card\n\nOnly one completed request." });
      await pending.promise;
    });
    expect(
      await within(screen.getByRole("tabpanel", { name: "Skill Card" })).findByText(
        "Only one completed request.",
      ),
    ).toBeTruthy();
    expect(getSkillCardMock).toHaveBeenCalledOnce();
  });

  it("retires a pending generated card when the selected version changes", async () => {
    const data = makeInitialData();
    if (!data.result?.latestVersion) throw new Error("Missing version fixture");
    const card = {
      path: "skill-card.md",
      size: 32,
      storageId,
      sha256: "generated-card",
      contentType: "text/markdown",
    };
    data.result.latestVersion.files = [card];
    data.result.latestVersion.generatedSkillCard = card;
    const oldRead = deferred<{ text: string }>();
    const newRead = deferred<{ text: string }>();
    getSkillCardMock.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const { rerender } = render(<SkillDetailPage slug="weather" initialData={data} />);
    const nextVersionId = "skillVersions:2" as Id<"skillVersions">;
    rerender(
      <SkillDetailPage
        slug="weather"
        initialData={{
          ...data,
          result: {
            ...data.result,
            latestVersion: { ...data.result.latestVersion, _id: nextVersionId, version: "3.0.0" },
          },
        }}
      />,
    );
    expect(getSkillCardMock.mock.calls).toEqual([[{ versionId }], [{ versionId: nextVersionId }]]);
    openReleaseDetails("3.0.0");
    fireEvent.click(screen.getByRole("tab", { name: "Skill Card" }));
    await act(async () => {
      oldRead.resolve({ text: "# Skill Card\n\nStale card content." });
      await oldRead.promise;
    });
    expect(screen.queryByText("Stale card content.")).toBeNull();
    await act(async () => {
      newRead.resolve({ text: "# Skill Card\n\nCurrent card content." });
      await newRead.promise;
    });
    expect(
      await within(screen.getByRole("tabpanel", { name: "Skill Card" })).findByText(
        "Current card content.",
      ),
    ).toBeTruthy();
    expect(getSkillCardMock).toHaveBeenCalledTimes(2);
  });

  it("renders related skills from the stored category with a browse link", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "keywords" in args &&
        Array.isArray((args as { keywords?: unknown }).keywords)
      ) {
        return {
          items: [
            {
              skill: makeWeatherSkill({
                _id: "skills:2" as Id<"skills">,
                slug: "pipeline-builder",
                displayName: "Pipeline Builder",
                summary: "Compose agent workflow pipelines.",
                stats: {
                  stars: 4,
                  downloads: 12,
                  installs: 3,
                  versions: 1,
                  comments: 0,
                },
              }),
              latestVersion: null,
              ownerHandle: "steipete",
              owner: null,
            },
          ],
        };
      }
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="workflow-runner"
        initialData={{
          result: {
            skill: {
              _id: skillId,
              _creationTime: 0,
              slug: "workflow-runner",
              displayName: "Workflow Runner",
              summary: "Build repeatable agent workflow pipelines.",
              categories: ["automation"],
              ownerUserId: ownerId,
              ownerPublisherId,
              tags: {},
              badges: {},
              stats: {
                stars: 12,
                downloads: 34,
                installs: 8,
                versions: 1,
                comments: 0,
              },
              createdAt: 0,
              updatedAt: 0,
            },
            owner: makeWeatherPublisher(),
            latestVersion: makeWeatherVersion(),
            forkOf: null,
            canonical: null,
          },
          readme: "# Workflow Runner",
          readmeError: null,
        }}
      />,
    );

    openReleaseDetails("1.0.0");
    expect(await screen.findByRole("heading", { name: "Related skills" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "View Automation skills" }).getAttribute("href")).toBe(
      "/skills?category=automation",
    );
    expect(screen.getByRole("link", { name: "More in Automation" }).getAttribute("href")).toBe(
      "/skills?category=automation",
    );
    expect(screen.getByRole("link", { name: /Pipeline Builder/i })).toBeTruthy();
    expect(screen.getByText(/Compose agent workflow pipelines\./i)).toBeTruthy();
  });

  it("offers owner-qualified CLI and Desktop choices in the sidebar and links the verdict to the audit", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: {
            skill: makeWeatherSkill(),
            owner: makeWeatherPublisher(),
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: {
                license: "MIT-0",
                frontmatter: {},
                clawdis: {
                  requires: {
                    env: ["WEATHER_API_KEY"],
                    bins: ["curl"],
                  },
                },
              },
              files: [],
              sha256hash: "abc123",
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: /^(?:Add|Install|Install options)$/i })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const sidebar = within(screen.getByRole("complementary"));
    const sidebarMetadata = sidebar.getByRole("group", { name: "Skill metadata" });
    const installCard = sidebar.getByRole("article", { name: "Install" });
    const install = within(installCard);
    expect(install.getByRole("button", { name: "CLI" }).getAttribute("aria-pressed")).toBe("true");
    expect(installCard.querySelector("pre code")?.textContent).toBe(
      "openclaw skills install @steipete/weather",
    );
    expect(install.getByRole("button", { name: "Copy OpenClaw CLI command" })).toBeTruthy();
    expect(install.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
    expect(install.queryByRole("button", { name: "npx skills" })).toBeNull();
    expect(install.queryByRole("button", { name: "Prompt" })).toBeNull();
    fireEvent.click(install.getByRole("button", { name: "Desktop" }));
    expect(install.getByRole("button", { name: "Desktop" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(install.getByRole("link", { name: "Install in OpenClaw" }).getAttribute("href")).toBe(
      "openclaw://skills/install?name=%40steipete%2Fweather",
    );
    expect(install.queryByRole("button", { name: "Copy OpenClaw CLI command" })).toBeNull();
    expect(screen.queryByText("npx clawhub@latest install @steipete/weather")).toBeNull();
    expect(screen.queryByRole("tab", { name: "ClawHub" })).toBeNull();
    expect(screen.queryByText(/After install, inspect the skill metadata/i)).toBeNull();
    expect(screen.getAllByText("Security check").length).toBeGreaterThan(0);
    const audit = sidebar.getByRole("link", { name: /View Security Audit.*Pending/i });
    expect(audit.getAttribute("href")).toBe("/steipete/skills/weather/security-audit");
    expect(within(audit).getByText("Pending")).toBeTruthy();
    expect(audit.textContent).not.toMatch(/audit/i);
    const sidebarLabels = Array.from(sidebarMetadata.querySelectorAll("dt"), (label) =>
      label.textContent?.trim(),
    );
    const securityAuditLabelIndex = sidebarLabels.findIndex((label) =>
      label?.startsWith("Security check"),
    );
    expect(sidebarLabels).not.toContain("Creator");
    expect(securityAuditLabelIndex).toBeGreaterThanOrEqual(0);
    const heroCreator = document.querySelector(".skill-catalog-byline");
    expect(heroCreator).toBeTruthy();
    const summary = document.querySelector(".catalog-detail__summary");
    expect(
      summary &&
        heroCreator &&
        heroCreator.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Security checks for vulnerabilities and agentic risk",
      }),
    ).toBeTruthy();
    expect(screen.queryByText("No risk analysis has been recorded yet.")).toBeNull();
    expect(screen.queryByText(/Like a lobster shell, security has layers/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();
    expect(screen.queryByText("Package contents")).toBeNull();
    expect(openReleaseDetails("1.0.0").getByRole("tab", { name: "Files" })).toBeTruthy();
  });

  it("shows the version scanner verdict even with legacy clean moderation metadata", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="kmind-markdown-to-mindmap"
        initialData={{
          result: {
            skill: makeWeatherSkill({
              slug: "kmind-markdown-to-mindmap",
              displayName: "KMind Markdown to Mindmap",
              summary: "Convert markdown to mindmaps.",
            }),
            owner: makeWeatherPublisher({
              handle: "suka233",
              displayName: "suka233",
            }),
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "0.1.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [],
              sha256hash: "abc123",
              llmAnalysis: { status: "suspicious", verdict: "suspicious", checkedAt: 1 },
              createdBy: ownerId,
              createdAt: 0,
            },
            moderationInfo: {
              isPendingScan: false,
              isMalwareBlocked: false,
              isSuspicious: false,
              isHiddenByMod: false,
              isRemoved: false,
              verdict: "clean",
              reasonCodes: ["suspicious.dynamic_code_execution"],
              summary: "Security findings were reviewed by staff and cleared for public use.",
              engineVersion: "v2.4.5",
              updatedAt: 1,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# KMind",
          readmeError: null,
        }}
      />,
    );

    expect((await screen.findAllByText("Security check")).length).toBeGreaterThan(0);
    const audit = screen.getByRole("link", { name: /View Security Audit.*Review/i });
    expect(within(audit).getByText("Review")).toBeTruthy();
    expect(audit.textContent).not.toMatch(/audit/i);
    expect(screen.queryByText(/reviewed by staff and cleared/i)).toBeNull();
    expect(screen.queryByText("Cleared")).toBeNull();
  });

  it("does not show a scanner rerun action on the settings page for owned skills", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: ownerId, role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "limit" in args) return [];
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        mode="settings"
        initialData={{
          result: {
            skill: makeWeatherSkill(),
            owner: makeWeatherPublisher(),
            latestVersion: {
              _id: versionId,
              _creationTime: 0,
              skillId,
              version: "1.0.0",
              fingerprint: "abc",
              changelog: "Initial release",
              parsed: { license: "MIT-0", frontmatter: {} },
              files: [],
              sha256hash: "abc123",
              createdBy: ownerId,
              createdAt: 0,
            },
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    await screen.findByText("Short summary");
    expect(screen.getByRole("link", { name: "New Version" }).getAttribute("href")).toBe(
      "/publish-skill?updateSlug=weather&ownerHandle=steipete",
    );
    expect(screen.queryByText(/request security/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();
    expect(screen.queryByText(/rescans/i)).toBeNull();
  });

  it("does not refetch readme when SSR data already matches the latest version", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        initialData={{
          result: makeWeatherSkillResult(),
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect((await screen.findAllByRole("heading", { name: "Weather" })).length).toBeGreaterThan(0);
    expect(screen.getByText(/Get current weather\./i)).toBeTruthy();
    expect(getReadmeMock).not.toHaveBeenCalled();
  });

  it("shows not found when skill query resolves to null", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      return null;
    });

    render(<SkillDetailPage slug="missing-skill" />);
    expect(
      await screen.findByRole("heading", { name: /We couldn't find that page/i }),
    ).toBeTruthy();
  });

  it("shows a pending publication notice to the signed-in owner after public SSR misses", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: ownerId, role: "user" },
    });
    useQueryMock.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (getFunctionName(query as never) !== "skills:getBySlug") return undefined;
      return {
        skill: makeMinimalWeatherSkill(),
        owner: makeWeatherPublisher(),
        latestVersion: null,
        moderationInfo: {
          isPendingScan: false,
          isMalwareBlocked: false,
          isSuspicious: false,
          isHiddenByMod: true,
          isRemoved: false,
          reason: "pending.publication",
        },
      };
    });

    render(<SkillDetailPage slug="weather" canonicalOwner="steipete" initialData={null} />);

    expect((await screen.findAllByRole("heading", { name: "Weather" })).length).toBeGreaterThan(0);
    expect(screen.getByText("Pending publication")).toBeTruthy();
    expect(screen.getByText(/not yet public or installable/i)).toBeTruthy();
    expect(screen.queryByRole("article", { name: "Install" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(?:Add|Install|Desktop)$/i })).toBeNull();
    expect(screen.queryByRole("link", { name: "Install in OpenClaw" })).toBeNull();
    expect(screen.queryByText("Skill hidden")).toBeNull();
    const files = openReleaseDetails();
    expect(files.getByText("Files pending security checks")).toBeTruthy();
    expect(files.queryByText("No README available")).toBeNull();
  });

  it("redirects legacy routes to canonical owner/slug", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      return {
        skill: makeMinimalWeatherSkill(),
        owner: makeWeatherPublisher(),
        latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {} },
      };
    });

    render(<SkillDetailPage slug="weather" redirectToCanonical />);
    expect(screen.getByRole("status", { name: /Loading skill details/i })).toBeTruthy();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/$owner/skills/$slug",
      params: { owner: "steipete", slug: "weather" },
      replace: true,
    });
  });

  it("redirects merged source slugs to the resolved canonical slug", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          requestedSlug: "old-weather",
          resolvedSlug: "weather",
          skill: {
            _id: "skills:1",
            slug: "weather",
            displayName: "Weather",
            summary: "Get current weather.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:steipete",
            tags: {},
            badges: {},
            stats: {
              stars: 0,
              downloads: 0,
              installs: 0,
              versions: 1,
              comments: 0,
            },
            createdAt: 0,
            updatedAt: 0,
          },
          owner: makeWeatherPublisher(),
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="old-weather" canonicalOwner="steipete" />);
    expect(screen.getByRole("status", { name: /Loading skill details/i })).toBeTruthy();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalled();
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/$owner/skills/$slug",
      params: { owner: "steipete", slug: "weather" },
      replace: true,
    });
  });

  it("does not redirect when a staff owner handle only differs by case", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:staff", role: "moderator" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: makeMinimalWeatherSkill(),
          owner: makeWeatherPublisher({
            handle: "SteiPete",
          }),
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(
      <SkillDetailPage
        slug="weather"
        canonicalOwner="steipete"
        initialData={{
          result: {
            skill: makeWeatherSkill(),
            owner: makeWeatherPublisher(),
            latestVersion: makeWeatherVersion(),
            forkOf: null,
            canonical: null,
          },
          readme: "# Weather",
          readmeError: null,
        }}
      />,
    );

    expect(screen.queryByText(/Loading skill/i)).toBeNull();
    expect(screen.getAllByText("Weather").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /settings/i }).getAttribute("href")).toBe(
      "/SteiPete/skills/weather/settings",
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("invalidates route data and updates the star button while the live skill query is stale", async () => {
    const toggleStarMock = vi
      .fn()
      .mockResolvedValueOnce({ starred: true })
      .mockResolvedValueOnce({ starred: false });
    useMutationMock.mockReturnValue(toggleStarMock);
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:viewer", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args && "limit" in args) return [];
      if (args && typeof args === "object" && "skillId" in args) return false;
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: makeWeatherSkill({
            stats: {
              stars: 8,
              downloads: 34,
              installs: 8,
              versions: 1,
              comments: 0,
            },
          }),
          owner: makeWeatherPublisher(),
          latestVersion: makeWeatherVersion(),
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);

    const starButton = await screen.findByRole("button", { name: "Bookmark skill" });
    expect(starButton.textContent).toContain("8");

    fireEvent.click(starButton);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unbookmark skill" }).textContent).toContain("9");
    });
    expect(toggleStarMock).toHaveBeenCalledWith({ skillId });

    fireEvent.click(screen.getByRole("button", { name: "Unbookmark skill" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Bookmark skill" }).textContent).toContain("8");
    });
    expect(toggleStarMock).toHaveBeenCalledTimes(2);
    expect(routerInvalidateMock).toHaveBeenCalledTimes(2);
  });

  it("renders refreshed starred server state with the synchronized star count", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:viewer", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args && "limit" in args) return [];
      if (args && typeof args === "object" && "skillId" in args) return true;
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: makeWeatherSkill({
            stats: {
              stars: 1,
              downloads: 34,
              installs: 8,
              versions: 1,
              comments: 0,
            },
          }),
          owner: makeWeatherPublisher(),
          latestVersion: makeWeatherVersion(),
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);

    expect((await screen.findByRole("button", { name: "Unbookmark skill" })).textContent).toContain(
      "1",
    );
  });

  it("opens report dialog for authenticated users", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:reporter", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return makeMinimalWeatherSkillResult();
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);

    expect(
      screen.queryByText(/Reports require a reason\. Abuse may result in a ban\./i),
    ).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /report/i }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Report skill/i)).toBeTruthy();
  });

  it("links owner tools from the detail page and renders them on settings", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        ("ownerUserId" in args || "ownerPublisherId" in args)
      ) {
        return [
          { _id: "skills:1", slug: "weather", displayName: "Weather" },
          { _id: "skills:2", slug: "weather-pro", displayName: "Weather Pro" },
        ];
      }
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return makeMinimalWeatherSkillResult();
      }
      return undefined;
    });

    const { unmount } = render(<SkillDetailPage slug="weather" />);

    const settingsLink = await screen.findByRole("link", { name: /settings/i });
    expect(settingsLink.getAttribute("href")).toBe("/steipete/skills/weather/settings");
    expect(screen.queryByText(/Owner tools/i)).toBeNull();
    unmount();

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    const newVersionLink = screen.getByRole("link", { name: /Update skill files/i });
    expect(newVersionLink.getAttribute("href")).toBe(
      "/skills/publish?updateSlug=weather&ownerHandle=steipete",
    );
    expect(screen.getByText("Rename slug")).toBeTruthy();
    expect(screen.getByText("Merge listing")).toBeTruthy();
  });

  it("lets owners confirm skill deletion from settings", async () => {
    const deleteSkill = vi.fn().mockResolvedValue({
      ok: true,
      slugReservedUntil: Date.UTC(2026, 6, 7),
    });
    useMutationMock.mockImplementation((mutation) =>
      getFunctionName(mutation) === "skills:setOwnedSkillSoftDeleted" ? deleteSkill : vi.fn(),
    );
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        ("ownerUserId" in args || "ownerPublisherId" in args)
      ) {
        return [{ _id: "skills:1", slug: "weather", displayName: "Weather" }];
      }
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return makeMinimalWeatherSkillResult();
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete skill" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));

    expect(deleteSkill).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete skill" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete skill" }));

    await waitFor(() => {
      expect(deleteSkill).toHaveBeenCalledWith({ skillId });
    });
    expect(toast.success).toHaveBeenCalledWith("Deleted weather.");
    expect(navigateMock).toHaveBeenCalledWith({ to: "/", replace: true });
  });

  it("does not show the owner delete action to staff-only settings viewers", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:moderator", role: "moderator" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return makeMinimalWeatherSkillResult();
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    expect(screen.getByText("Rename slug")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete skill" })).toBeNull();
  });

  it.each([
    {
      label: "active",
      availability: {},
      moderationInfo: null,
      shouldShowDelete: true,
    },
    {
      label: "soft-deleted",
      availability: { softDeletedAt: 123 },
      moderationInfo: null,
      shouldShowDelete: false,
    },
    {
      label: "hidden by moderation",
      availability: { moderationStatus: "hidden" as const },
      moderationInfo: null,
      shouldShowDelete: false,
    },
    {
      label: "removed by moderation",
      availability: { moderationStatus: "removed" as const },
      moderationInfo: null,
      shouldShowDelete: false,
    },
    {
      label: "legacy hiddenAt-only",
      availability: { hiddenAt: 123 },
      moderationInfo: null,
      shouldShowDelete: true,
    },
    {
      label: "owner-visible hidden public result",
      availability: {},
      moderationInfo: {
        isPendingScan: false,
        isMalwareBlocked: false,
        isSuspicious: false,
        isHiddenByMod: true,
        isRemoved: false,
      },
      shouldShowDelete: false,
    },
  ])(
    "$label skill aligns version Delete visibility with mutation availability",
    async ({ availability, moderationInfo, shouldShowDelete }) => {
      useAuthStatusMock.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
        me: { _id: "users:1", role: "user" },
      });
      useQueryMock.mockImplementation((query: unknown, args: unknown) => {
        if (args === "skip") return undefined;
        const name = getFunctionName(query as never);
        if (name === "skills:getBySlug") {
          return {
            skill: {
              _id: "skills:1",
              slug: "weather",
              displayName: "Weather",
              summary: "Get current weather.",
              ownerUserId: "users:1",
              ownerPublisherId: "publishers:steipete",
              tags: {},
              stats: { stars: 0, downloads: 0 },
              ...availability,
            },
            owner: makeWeatherPublisher(),
            latestVersion: {
              _id: "skillVersions:latest",
              version: "2.0.0",
              parsed: {},
              files: [],
            },
            moderationInfo,
          };
        }
        if (
          name === "skills:listVersions" &&
          args &&
          typeof args === "object" &&
          "limit" in args &&
          args.limit === 50
        ) {
          return [
            {
              _id: "skillVersions:latest",
              version: "2.0.0",
              createdAt: 2,
              changelog: "Current skill release",
              parsed: {},
              files: [],
            },
            {
              _id: "skillVersions:older",
              version: "1.0.0",
              createdAt: 1,
              changelog: "Older skill release",
              parsed: {},
              files: [],
            },
          ];
        }
        if (name === "publishers:listMine") return [];
        return undefined;
      });

      render(<SkillDetailPage slug="weather" />);
      fireEvent.click(openReleaseDetails("2.0.0").getByRole("tab", { name: "Versions" }));

      expect(await screen.findByText("Latest")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Delete version 2.0.0" })).toBeNull();
      const deleteAction = screen.queryByRole("button", { name: "Delete version 1.0.0" });
      if (shouldShowDelete) {
        expect(deleteAction).toBeTruthy();
      } else {
        expect(deleteAction).toBeNull();
      }
    },
  );

  it("keeps version Delete hidden from staff-only skill viewers", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:moderator", role: "moderator" },
    });
    useQueryMock.mockImplementation((query: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(query as never);
      if (name === "skills:getBySlugForStaff") {
        return {
          skill: makeMinimalWeatherSkill(),
          owner: makeWeatherPublisher(),
          latestVersion: {
            _id: "skillVersions:latest",
            version: "2.0.0",
            parsed: {},
            files: [],
          },
        };
      }
      if (
        name === "skills:listVersions" &&
        args &&
        typeof args === "object" &&
        "limit" in args &&
        args.limit === 50
      ) {
        return [
          {
            _id: "skillVersions:latest",
            version: "2.0.0",
            createdAt: 2,
            changelog: "Current skill release",
            parsed: {},
            files: [],
          },
          {
            _id: "skillVersions:older",
            version: "1.0.0",
            createdAt: 1,
            changelog: "Older skill release",
            parsed: {},
            files: [],
          },
        ];
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);
    fireEvent.click(openReleaseDetails("2.0.0").getByRole("tab", { name: "Versions" }));

    expect(await screen.findByText("Latest")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete version/ })).toBeNull();
  });

  it("does not show the owner delete action to org skill creators without org admin access", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:creator", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) return [];
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: makeMinimalWeatherSkill({
            ownerUserId: "users:creator",
            ownerPublisherId: "publishers:org",
          }),
          owner: {
            _id: "publishers:org",
            _creationTime: 0,
            kind: "org",
            handle: "weather-org",
            displayName: "Weather Org",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" mode="settings" />);

    expect(await screen.findByRole("heading", { name: /Skill settings/i })).toBeTruthy();
    expect(screen.getByText("Rename slug")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete skill" })).toBeNull();
  });

  it("does not expose settings to publisher members without admin access", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:publisher-member", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args === undefined) {
        return [{ publisher: { _id: "publishers:steipete" }, role: "publisher" }];
      }
      if (args && typeof args === "object" && "skillId" in args) return false;
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: makeMinimalWeatherSkill(),
          owner: {
            _id: "publishers:steipete",
            _creationTime: 0,
            kind: "org",
            handle: "steipete",
            displayName: "Peter",
          },
          latestVersion: { _id: "skillVersions:1", version: "1.0.0", parsed: {}, files: [] },
        };
      }
      return undefined;
    });

    const { unmount } = render(<SkillDetailPage slug="weather" />);
    await waitFor(() =>
      expect(document.querySelector(".catalog-detail__title-row h1")?.textContent).toBe("Weather"),
    );
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
    unmount();

    render(<SkillDetailPage slug="weather" mode="settings" />);
    expect(await screen.findByRole("heading", { name: /Settings unavailable/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Update skill files/i })).toBeNull();
  });

  it("does not render version tag cards on the simplified public detail surface", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "skillId" in args) {
        return [
          { _id: "skillVersions:1", version: "1.0.7", files: [] },
          { _id: "skillVersions:2", version: "1.0.8", files: [] },
        ];
      }
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:ip-publisher",
            slug: "ip-publisher",
            displayName: "IP Publisher",
            summary: "Publish knowledge-base content everywhere.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:veeicwgy",
            latestVersionId: "skillVersions:2",
            tags: {
              "ip-publisher": "skillVersions:2",
              "knowledge-base": "skillVersions:2",
              "content-rewrite": "skillVersions:1",
            },
            stats: { stars: 0, downloads: 0 },
          },
          owner: makeWeatherPublisher({
            _id: "publishers:veeicwgy",
            handle: "veeicwgy",
            displayName: "Vee",
          }),
          latestVersion: {
            _id: "skillVersions:2",
            version: "1.0.8",
            parsed: {},
            files: [],
          },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="ip-publisher" />);

    expect((await screen.findAllByText("IP Publisher")).length).toBeGreaterThan(0);
    openReleaseDetails("1.0.8");
    expect(screen.queryByText("Version tags")).toBeNull();
    expect(screen.queryByText("knowledge-base")).toBeNull();
    expect(screen.queryByText("content-rewrite")).toBeNull();
    expect(screen.queryByText("Historical tags")).toBeNull();
  });

  it("does not render historical tag controls for managers on the simplified detail surface", async () => {
    useAuthStatusMock.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
      me: { _id: "users:1", role: "user" },
    });
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (args && typeof args === "object" && "ownerUserId" in args) {
        return [{ _id: "skills:ip-publisher", slug: "ip-publisher", displayName: "IP Publisher" }];
      }
      if (args && typeof args === "object" && "skillId" in args) {
        return [
          { _id: "skillVersions:1", version: "1.0.7", files: [] },
          { _id: "skillVersions:2", version: "1.0.8", files: [] },
        ];
      }
      if (args && typeof args === "object" && "slug" in args) {
        return {
          skill: {
            _id: "skills:ip-publisher",
            slug: "ip-publisher",
            displayName: "IP Publisher",
            summary: "Publish knowledge-base content everywhere.",
            ownerUserId: "users:1",
            ownerPublisherId: "publishers:veeicwgy",
            latestVersionId: "skillVersions:2",
            tags: {
              "ip-publisher": "skillVersions:2",
              "knowledge-base": "skillVersions:2",
              "content-rewrite": "skillVersions:1",
            },
            stats: { stars: 0, downloads: 0 },
          },
          owner: makeWeatherPublisher({
            _id: "publishers:veeicwgy",
            handle: "veeicwgy",
            displayName: "Vee",
          }),
          latestVersion: {
            _id: "skillVersions:2",
            version: "1.0.8",
            parsed: {},
            files: [],
          },
          forkOf: null,
          canonical: null,
        };
      }
      return undefined;
    });

    render(<SkillDetailPage slug="ip-publisher" />);

    expect((await screen.findAllByText("IP Publisher")).length).toBeGreaterThan(0);
    openReleaseDetails("1.0.8");
    expect(screen.queryByText("Version tags")).toBeNull();
    expect(screen.queryByText("Historical tags")).toBeNull();
    expect(screen.queryByText("content-rewrite")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete tag content-rewrite" })).toBeNull();
  });

  it("does not request compare versions for the simplified detail tabs", async () => {
    useQueryMock.mockImplementation((_fn: unknown, args: unknown) => {
      if (args === "skip") return undefined;
      if (
        args &&
        typeof args === "object" &&
        "skillId" in args &&
        "limit" in args &&
        (args as { limit: number }).limit === 50
      ) {
        return [
          { _id: "skillVersions:1", version: "1.0.0", files: [] },
          { _id: "skillVersions:2", version: "1.1.0", files: [] },
        ];
      }
      if (args && typeof args === "object" && "skillId" in args && "limit" in args) {
        if ((args as { limit: number }).limit === 200) return [];
      }
      if (args && typeof args === "object" && "limit" in args) {
        return [];
      }
      if (args && typeof args === "object" && "slug" in args) {
        return makeMinimalWeatherSkillResult();
      }
      return undefined;
    });

    render(<SkillDetailPage slug="weather" />);
    await waitFor(() =>
      expect(document.querySelector(".catalog-detail__title-row h1")?.textContent).toBe("Weather"),
    );
    openReleaseDetails("1.0.0");
    expect(getReleaseTabs().getByRole("tab", { name: "SKILL.md" })).toBeTruthy();
    expect(getReleaseTabs().getByRole("tab", { name: "Files" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /diff/i })).toBeNull();

    expect(
      useQueryMock.mock.calls.some((call) => {
        const args = call[1];
        return (
          typeof args === "object" &&
          args !== null &&
          "limit" in args &&
          (args as { limit: number }).limit === 200
        );
      }),
    ).toBe(false);
  });
});
