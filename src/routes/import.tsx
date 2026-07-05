import { createFileRoute, useSearch } from "@tanstack/react-router";
import { inferSkillCategories, resolveSkillCategories } from "clawhub-schema";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_NAME,
  PLATFORM_SKILL_LICENSE_SUMMARY,
} from "clawhub-schema/licenseConstants";
import { useAction, useQueries } from "convex/react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleX,
  Copy,
  Eye,
  ExternalLink,
  ListChecks,
  Lock,
  RefreshCw,
  Rocket,
  Search,
} from "lucide-react";
import {
  type ReactNode,
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import {
  CatalogMetadataFields,
  parseCatalogTopicsInput,
} from "../components/CatalogMetadataFields";
import { copyText } from "../components/InstallCopyButton";
import { Container } from "../components/layout/Container";
import { SignInPrompt } from "../components/SignInPrompt";
import { ImportGitHubSkeleton } from "../components/skeletons/ProtectedPageSkeletons";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { getUserFacingConvexError } from "../lib/convexError";
import { getClawHubSiteUrl, SITE_NAME } from "../lib/site";
import { getPublicSlugCollision } from "../lib/slugCollision";
import { formatBytes } from "../lib/uploadUtils";
import { useAuthStatus } from "../lib/useAuthStatus";

export const Route = createFileRoute("/import")({
  validateSearch: (search: Record<string, unknown>) => ({
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  }),
  head: () => {
    const siteUrl = getClawHubSiteUrl();
    const title = `Import from GitHub | ${SITE_NAME}`;
    const description =
      "Import SKILL.md and skills.md files from your public GitHub repositories into ClawHub.";

    return {
      links: [
        {
          rel: "canonical",
          href: `${siteUrl}/import`,
        },
      ],
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `${siteUrl}/import` },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  component: ImportGitHub,
});

type Candidate = {
  path: string;
  readmePath: string;
  name: string | null;
  description: string | null;
};

type CandidatePreview = {
  resolved: {
    owner: string;
    repo: string;
    ref: string;
    commit: string;
    path: string;
    repoUrl: string;
    originalUrl: string;
  };
  candidate: Candidate;
  defaults: {
    selectedPaths: string[];
    slug: string;
    displayName: string;
    version: string;
    tags: string[];
  };
  files: Array<{ path: string; size: number; defaultSelected: boolean }>;
};

type OwnedGitHubRepo = {
  owner: string;
  name: string;
  repoName: string;
  repoFullName: string;
  fullName: string;
  htmlUrl: string;
  candidatePath: string;
  skillPath: string;
  pushedAt: string | null;
  updatedAt: string | null;
  language: string | null;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
  importable: boolean;
  unavailableReason: string | null;
};

type ReviewDraft = {
  repo: OwnedGitHubRepo;
  preview: CandidatePreview;
  selected: Record<string, boolean>;
  slug: string;
  displayName: string;
  version: string;
  tags: string;
  categories: string[];
  topics: string;
};

type SlugAvailabilityResult =
  | {
      available: boolean;
      reason: "available" | "taken" | "reserved";
      message: string | null;
      url: string | null;
    }
  | null
  | undefined
  | Error;

type PublishResultRow = {
  key: string;
  name: string;
  ok: boolean;
  slug?: string;
  message?: string;
};

const OPENCLAW_SKILLS_DISCORD_URL =
  "https://discord.com/channels/1456350064065904867/1456891440897724637";
const PUBLIC_CLAWHUB_SITE_URL = "https://clawhub.ai";
const LOCAL_SHARE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const GITHUB_REPO_PAGE_SIZE = 100;
const DEV_MOCK_SKILL_NAMES = [
  "agent-release-notes",
  "audit-brief",
  "branch-cleanup",
  "context-pack",
  "daily-standup",
  "deploy-smoke",
  "docs-review",
  "handoff-writer",
  "issue-triage",
  "launch-checklist",
  "migration-plan",
  "pr-comment-sweeper",
  "release-captain",
  "security-pass",
  "test-designer",
];
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function ImportGitHub() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const { ownerHandle: requestedOwnerHandle } = useSearch({ from: "/import" });
  const listOwnedRepos = useAction(api.githubImport.listOwnedPublicGitHubRepos);
  const previewCandidate = useAction(api.githubImport.previewGitHubImportCandidate);
  const importSkill = useAction(api.githubImport.importGitHubSkill);

  const [selectedRepoKeys, setSelectedRepoKeys] = useState<Record<string, boolean>>({});
  const [reviewQueue, setReviewQueue] = useState<OwnedGitHubRepo[]>([]);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [expandedDraftKeys, setExpandedDraftKeys] = useState<Record<string, boolean>>({});
  const [acceptedLicenseTerms, setAcceptedLicenseTerms] = useState(false);
  const [publishResults, setPublishResults] = useState<PublishResultRow[]>([]);
  const [repos, setRepos] = useState<OwnedGitHubRepo[]>([]);
  const [accountLogin, setAccountLogin] = useState<string | null>(null);
  const [accountAvatarUrl, setAccountAvatarUrl] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [repoListPage, setRepoListPage] = useState(1);
  const [repoListQuery, setRepoListQuery] = useState("");
  const [hasMoreRepos, setHasMoreRepos] = useState(false);
  const [repoListStatus, setRepoListStatus] = useState<string | null>(null);
  const [repoListError, setRepoListError] = useState<string | null>(null);
  const [isRepoListBusy, setIsRepoListBusy] = useState(false);
  const [reviewLoadStatus, setReviewLoadStatus] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const ownerHandle = requestedOwnerHandle?.trim() || me?.handle?.trim() || "";
  const repoLoadSeq = useRef(0);
  const reposRef = useRef<OwnedGitHubRepo[]>([]);

  const visibleRepos = useMemo(() => {
    const query = repoSearch.trim().toLowerCase();
    return repos.filter((repo) => {
      if (!query) return true;
      return (
        repo.name.toLowerCase().includes(query) ||
        repo.repoName.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query) ||
        repo.repoFullName.toLowerCase().includes(query)
      );
    });
  }, [repoSearch, repos]);
  const showRepoSearch = repos.length > 10 || hasMoreRepos || repoSearch.trim().length > 0;
  const selectedRepoItems = useMemo(
    () => repos.filter((repo) => selectedRepoKeys[getRepoKey(repo)]),
    [repos, selectedRepoKeys],
  );
  const orderedDrafts = useMemo(
    () =>
      reviewQueue
        .map((repo) => reviewDrafts[getRepoKey(repo)])
        .filter((draft): draft is ReviewDraft => Boolean(draft)),
    [reviewDrafts, reviewQueue],
  );
  const publishSucceeded =
    publishResults.length > 0 &&
    publishResults.length === orderedDrafts.length &&
    publishResults.every((result) => result.ok);
  const isReviewing = reviewQueue.length > 0;
  const isReviewLoading = isReviewing && orderedDrafts.length < reviewQueue.length;

  const slugQueries = useMemo(() => {
    const queries: Record<
      string,
      {
        query: typeof api.skills.checkSlugAvailability;
        args: { slug: string; ownerHandle: string };
      }
    > = {};
    for (const draft of orderedDrafts) {
      const slug = draft.slug.trim().toLowerCase();
      if (ownerHandle && slug && SLUG_PATTERN.test(slug)) {
        queries[toSlugQueryKey(getRepoKey(draft.repo))] = {
          query: api.skills.checkSlugAvailability,
          args: { slug, ownerHandle },
        };
      }
    }
    return queries;
  }, [orderedDrafts, ownerHandle]);
  const slugResults = useQueries(slugQueries) as Record<string, SlugAvailabilityResult>;

  const duplicateSlugKeys = useMemo(() => {
    const seen = new Map<string, string>();
    const duplicates = new Set<string>();
    for (const draft of orderedDrafts) {
      const key = getRepoKey(draft.repo);
      const slug = draft.slug.trim().toLowerCase();
      if (!slug) continue;
      const firstKey = seen.get(slug);
      if (firstKey) {
        duplicates.add(firstKey);
        duplicates.add(key);
      } else {
        seen.set(slug, key);
      }
    }
    return duplicates;
  }, [orderedDrafts]);

  const reviewIssuesByKey = useMemo(() => {
    const issues: Record<string, string[]> = {};
    for (const draft of orderedDrafts) {
      const key = getRepoKey(draft.repo);
      issues[key] = getDraftIssues({
        draft,
        slugResult: slugResults[toSlugQueryKey(key)],
        isDuplicateSlug: duplicateSlugKeys.has(key),
      });
      if (!ownerHandle) {
        issues[key]?.push("Unable to resolve your publisher handle. Sign out and sign back in.");
      }
    }
    return issues;
  }, [duplicateSlugKeys, orderedDrafts, ownerHandle, slugResults]);

  const hasReviewIssues = useMemo(
    () => Object.values(reviewIssuesByKey).some((issues) => issues.length > 0),
    [reviewIssuesByKey],
  );
  const hasPendingSlugChecks = useMemo(
    () =>
      orderedDrafts.some((draft) => {
        const slug = draft.slug.trim().toLowerCase();
        return (
          slug &&
          SLUG_PATTERN.test(slug) &&
          slugResults[toSlugQueryKey(getRepoKey(draft.repo))] === undefined
        );
      }),
    [orderedDrafts, slugResults],
  );
  const canPublish =
    orderedDrafts.length > 0 &&
    orderedDrafts.length === reviewQueue.length &&
    acceptedLicenseTerms &&
    !hasReviewIssues &&
    !hasPendingSlugChecks &&
    !isBusy;
  const publishStatus = getPublishStatus({
    acceptedLicenseTerms,
    hasPendingSlugChecks,
    reviewIssuesByKey,
    status,
  });

  const loadRepos = useCallback(
    async (options?: { query?: string; page?: number; append?: boolean }) => {
      const query = options?.query?.trim() ?? "";
      const page = options?.page ?? 1;
      const append = options?.append ?? false;
      const requestId = repoLoadSeq.current + 1;
      repoLoadSeq.current = requestId;

      setIsRepoListBusy(true);
      setRepoListError(null);
      setRepoListStatus(null);
      try {
        const result = await listOwnedRepos({
          page,
          perPage: GITHUB_REPO_PAGE_SIZE,
          query: query || undefined,
        });
        if (requestId !== repoLoadSeq.current) return;

        const fetchedRepos = (result.repos ?? []) as OwnedGitHubRepo[];
        const nextRepos = append
          ? mergeRepoLists(reposRef.current, fetchedRepos)
          : expandDevMockSkillRepos(fetchedRepos);
        const accountLoginValue =
          typeof result.account?.login === "string" && result.account.login.trim()
            ? result.account.login.trim()
            : null;
        const accountAvatarValue =
          typeof result.account?.avatarUrl === "string" && result.account.avatarUrl.trim()
            ? result.account.avatarUrl.trim()
            : null;
        setAccountLogin(accountLoginValue);
        setAccountAvatarUrl(accountAvatarValue);
        reposRef.current = nextRepos;
        setRepos(nextRepos);
        setRepoListPage(page);
        setRepoListQuery(query);
        setHasMoreRepos(result.hasMore);
        setSelectedRepoKeys((current) => {
          return Object.fromEntries(
            nextRepos.map((repo) => {
              const key = getRepoKey(repo);
              return [key, current[key] ?? true];
            }),
          );
        });
        if (nextRepos.length === 0) {
          setRepoListStatus(query ? "No matching skills." : "No skills found.");
        } else {
          setRepoListStatus(null);
        }
      } catch (e) {
        if (requestId !== repoLoadSeq.current) return;
        setRepoListError(getUserFacingConvexError(e, "Could not load GitHub repos"));
      } finally {
        if (requestId === repoLoadSeq.current) setIsRepoListBusy(false);
      }
    },
    [listOwnedRepos],
  );

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const timer = window.setTimeout(
      () => {
        void loadRepos({ query: repoSearch });
      },
      repoSearch.trim() ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, loadRepos, repoSearch]);

  useEffect(() => {
    if (orderedDrafts.length === 0) return;
    setReviewDrafts((current) => {
      const used = new Set<string>();
      let changed = false;
      const next = { ...current };
      for (const draft of orderedDrafts) {
        const key = getRepoKey(draft.repo);
        const slug = draft.slug.trim().toLowerCase();
        if (!slug || !SLUG_PATTERN.test(slug)) continue;
        if (used.has(slug)) {
          const replacement = nextNumericSlug(slug, used);
          next[key] = { ...draft, slug: replacement };
          used.add(replacement);
          changed = true;
        } else {
          used.add(slug);
        }
      }
      return changed ? next : current;
    });
  }, [orderedDrafts]);

  useEffect(() => {
    if (orderedDrafts.length === 0) return;
    setReviewDrafts((current) => {
      let changed = false;
      const next = { ...current };
      const used = new Set(
        Object.values(current)
          .map((draft) => draft.slug.trim().toLowerCase())
          .filter(Boolean),
      );
      for (const draft of orderedDrafts) {
        const key = getRepoKey(draft.repo);
        const result = slugResults[toSlugQueryKey(key)];
        if (!result || result instanceof Error || result.available) continue;
        const replacement = nextNumericSlug(draft.slug, used);
        next[key] = { ...draft, slug: replacement };
        used.add(replacement);
        changed = true;
      }
      return changed ? next : current;
    });
  }, [orderedDrafts, slugResults]);

  const toggleRepoSelection = (repo: OwnedGitHubRepo) => {
    const key = getRepoKey(repo);
    setSelectedRepoKeys((current) => ({ ...current, [key]: !current[key] }));
  };

  const allVisibleReposSelected =
    visibleRepos.length > 0 && visibleRepos.every((repo) => selectedRepoKeys[getRepoKey(repo)]);

  const toggleAllVisibleRepos = () => {
    setSelectedRepoKeys((current) => {
      const next = { ...current };
      for (const repo of visibleRepos) {
        next[getRepoKey(repo)] = !allVisibleReposSelected;
      }
      return next;
    });
  };

  const updateDraft = (key: string, patch: Partial<ReviewDraft>) => {
    setReviewDrafts((current) => {
      const draft = current[key];
      if (!draft) return current;
      return { ...current, [key]: { ...draft, ...patch } };
    });
  };

  const updateDraftSelection = (key: string, path: string) => {
    setReviewDrafts((current) => {
      const draft = current[key];
      if (!draft) return current;
      if (path === draft.preview.candidate.readmePath) return current;
      return {
        ...current,
        [key]: {
          ...draft,
          selected: { ...draft.selected, [path]: !draft.selected[path] },
        },
      };
    });
  };

  const applyFileSelection = (key: string, mode: "skill" | "all") => {
    setReviewDrafts((current) => {
      const draft = current[key];
      if (!draft) return current;
      const nextSelected: Record<string, boolean> = {};
      for (const file of draft.preview.files) {
        nextSelected[file.path] =
          file.path === draft.preview.candidate.readmePath || mode === "all";
      }
      return { ...current, [key]: { ...draft, selected: nextSelected } };
    });
  };

  const startReview = async () => {
    if (selectedRepoItems.length === 0) return;
    const nextQueue = selectedRepoItems;
    setReviewQueue(nextQueue);
    setReviewDrafts({});
    setExpandedDraftKeys({});
    setAcceptedLicenseTerms(false);
    setPublishResults([]);
    setError(null);
    setStatus(null);
    setIsBusy(true);
    try {
      const drafts: Record<string, ReviewDraft> = {};
      const usedSlugs = new Set<string>();
      for (let index = 0; index < nextQueue.length; index += 1) {
        const repo = nextQueue[index] as OwnedGitHubRepo;
        setReviewLoadStatus(`Preparing ${index + 1} of ${nextQueue.length}`);
        const result = (await previewCandidate({
          url: repo.htmlUrl,
          candidatePath: repo.candidatePath,
        })) as CandidatePreview;
        const selected: Record<string, boolean> = {};
        for (const file of result.files) selected[file.path] = file.defaultSelected;
        const slug = nextNumericSlug(result.defaults.slug, usedSlugs);
        usedSlugs.add(slug);
        drafts[getRepoKey(repo)] = {
          repo,
          preview: result,
          selected,
          slug,
          displayName: result.defaults.displayName,
          version: result.defaults.version,
          tags: (result.defaults.tags ?? ["latest"]).join(","),
          categories: [],
          topics: "",
        };
      }
      setReviewDrafts(drafts);
      setReviewLoadStatus(null);
    } catch (e) {
      setError(getUserFacingConvexError(e, "Preview failed"));
      setReviewQueue([]);
      setReviewDrafts({});
      setExpandedDraftKeys({});
      setReviewLoadStatus(null);
    } finally {
      setIsBusy(false);
    }
  };

  const cancelReview = () => {
    setReviewQueue([]);
    setReviewDrafts({});
    setExpandedDraftKeys({});
    setAcceptedLicenseTerms(false);
    setReviewLoadStatus(null);
    setStatus(null);
    setError(null);
  };

  const importDraft = async (draft: ReviewDraft) => {
    const selectedPaths = draft.preview.files
      .map((file) => file.path)
      .filter((path) => draft.selected[path]);
    const tagList = draft.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    return importSkill({
      url: draft.preview.resolved.originalUrl,
      commit: draft.preview.resolved.commit,
      candidatePath: draft.preview.candidate.path,
      selectedPaths,
      slug: draft.slug.trim(),
      ownerHandle,
      displayName: draft.displayName.trim(),
      version: draft.version.trim(),
      tags: tagList,
      ...(draft.categories.length ? { categories: draft.categories } : {}),
      ...(draft.topics.trim() ? { topics: parseCatalogTopicsInput(draft.topics) } : {}),
      acceptLicenseTerms: acceptedLicenseTerms,
    });
  };

  const publishReviewed = async () => {
    if (!canPublish) return;
    setIsBusy(true);
    setError(null);
    const results = publishResults.filter((item) => item.ok && item.slug);
    const publishedKeys = new Set(results.map((item) => item.key));
    setPublishResults(results);
    try {
      for (let index = 0; index < orderedDrafts.length; index += 1) {
        const draft = orderedDrafts[index] as ReviewDraft;
        const key = getRepoKey(draft.repo);
        if (publishedKeys.has(key)) continue;
        setStatus(`Publishing ${index + 1} of ${orderedDrafts.length}`);
        try {
          const result = await importDraft(draft);
          results.push({ key, name: draft.displayName, ok: true, slug: result.slug });
          publishedKeys.add(key);
        } catch (e) {
          results.push({
            key,
            name: draft.displayName,
            ok: false,
            message: getUserFacingConvexError(e, "Import failed"),
          });
        }
        setPublishResults([...results]);
      }
      setStatus(`Published ${results.filter((item) => item.ok).length} of ${orderedDrafts.length}`);
    } catch (e) {
      toast.error(getUserFacingConvexError(e, "Import failed"));
      setStatus(null);
    } finally {
      setIsBusy(false);
    }
  };

  if (isLoading) {
    return <ImportGitHubSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return (
      <SignInPrompt
        title="Sign in to import and publish skills"
        description="You need to be signed in to import skills from GitHub."
      />
    );
  }

  return (
    <main className="relative isolate py-10">
      <Container size="narrow" className="relative z-10">
        <div>
          <header className="mb-6 flex flex-col gap-8">
            <div className="w-full">
              <ImportStepper
                current={isReviewing ? (publishResults.length > 0 ? 3 : 2) : 1}
                onSelect={isReviewing && !isBusy ? cancelReview : undefined}
                onReview={
                  !isReviewing && selectedRepoItems.length > 0 && !isBusy ? startReview : undefined
                }
                onPublish={isReviewing && canPublish ? publishReviewed : undefined}
              />
            </div>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1.5">
                <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
                  Import from GitHub
                </h1>
                <p className="text-sm text-[color:var(--ink-soft)]">
                  {publishSucceeded
                    ? "Ready to share"
                    : isReviewing
                      ? "Review selected skills before publishing"
                      : "Select skills"}
                </p>
              </div>
              <div className="w-full sm:max-w-[320px]">
                <img
                  src="/github-import-hero-art.png"
                  alt=""
                  className="w-[220px] max-w-[70vw] select-none object-contain sm:ml-auto"
                  draggable={false}
                />
              </div>
            </div>
          </header>

          {!isReviewing ? (
            <section className="mb-6 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-h-[52px] min-w-0 flex-1 items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-muted)_72%,transparent),var(--surface))] px-3.5 text-[color:var(--ink)] sm:max-w-[320px]">
                  <span className="flex min-w-0 items-center gap-3.5">
                    {(accountAvatarUrl ?? me?.image) ? (
                      <img
                        src={accountAvatarUrl ?? me?.image ?? ""}
                        alt=""
                        className="h-8 w-8 rounded-full border border-[color:var(--line)]"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <GitHubMark size={18} />
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-xs text-[color:var(--ink-soft)]">
                        <GitHubMark size={11} />
                        GitHub account
                      </span>
                      <span className="block truncate text-sm font-medium sm:text-[15px]">
                        {accountLogin ?? me?.handle ?? me?.name ?? "GitHub"}
                      </span>
                    </span>
                  </span>
                  {!isRepoListBusy ? (
                    <TooltipProvider delayDuration={120}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 border-transparent bg-transparent text-[color:var(--ink-soft)] hover:bg-transparent hover:text-[color:var(--ink)]"
                            aria-label="Update list"
                            onClick={() => void loadRepos({ query: repoSearch })}
                          >
                            <RefreshCw className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="end">
                          Update list
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-sm text-[color:var(--ink-soft)]">
                    <span>{selectedRepoItems.length} selected</span>
                    {visibleRepos.length > 0 ? (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <button
                          type="button"
                          onClick={toggleAllVisibleRepos}
                          className="cursor-pointer font-medium text-[color:var(--ink)] hover:text-[color:var(--accent-deep)]"
                        >
                          {allVisibleReposSelected ? "Clear selection" : "Select all"}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
              {showRepoSearch ? (
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--ink-soft)]"
                    aria-hidden="true"
                  />
                  <Input
                    className="github-import-input min-h-[46px] pl-10 pr-10 text-sm"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search..."
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  {repoSearch ? (
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[color:var(--ink-soft)] transition-colors hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)]"
                      aria-label="Clear search"
                      onClick={() => setRepoSearch("")}
                    >
                      <CircleX className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ) : null}

              {repoListError ? (
                <div className="rounded-[var(--radius-sm)] border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300">
                  {repoListError}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-[var(--radius-sm)] border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300">
                  {error}
                </div>
              ) : null}

              {isRepoListBusy ? (
                <LoadingPanel
                  label="Finding skills"
                  description="Scanning your public GitHub repos for SKILL.md files"
                />
              ) : visibleRepos.length > 0 ? (
                <>
                  <div className="overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)]">
                    {visibleRepos.map((repo) => {
                      const rowKey = getRepoKey(repo);
                      const checked = selectedRepoKeys[rowKey];
                      return (
                        <label
                          key={rowKey}
                          className="flex min-h-[72px] cursor-pointer items-center justify-between gap-4 border-b border-[color:var(--line)] px-4 py-3 transition-colors last:border-b-0 hover:bg-[color:var(--surface-muted)] sm:px-5"
                        >
                          <div className="flex min-w-0 items-center gap-3.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--line)] text-[color:var(--ink-soft)]">
                              <GitHubMark size={15} />
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-[15px] font-semibold leading-5 text-[color:var(--ink)]">
                                {repo.name}
                              </div>
                              <div className="truncate text-xs leading-5 text-[color:var(--ink-soft)]">
                                {repo.repoFullName} &middot;{" "}
                                {formatRepoDate(repo.pushedAt ?? repo.updatedAt)}
                              </div>
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 cursor-pointer accent-[color:var(--accent)] disabled:cursor-not-allowed"
                            checked={checked}
                            onChange={() => toggleRepoSelection(repo)}
                            disabled={!repo.importable}
                          />
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    {hasMoreRepos ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={isRepoListBusy}
                        onClick={() =>
                          void loadRepos({
                            query: repoListQuery,
                            page: repoListPage + 1,
                            append: true,
                          })
                        }
                      >
                        Load more
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Button
                      variant="primary"
                      disabled={selectedRepoItems.length === 0 || isBusy}
                      loading={isBusy}
                      onClick={() => void startReview()}
                    >
                      Review selected
                    </Button>
                  </div>
                </>
              ) : repoSearch.trim() ? (
                <p className="text-sm text-[color:var(--ink-soft)]">No matching skills.</p>
              ) : repoListStatus ? (
                <p className="text-sm text-[color:var(--ink-soft)]">{repoListStatus}</p>
              ) : null}
            </section>
          ) : null}

          {isReviewLoading ? (
            <LoadingPanel
              label={reviewLoadStatus ?? "Preparing import"}
              description="Setting up your skills"
            />
          ) : null}

          {publishSucceeded ? (
            <PublishedImportSuccess
              drafts={orderedDrafts}
              ownerHandle={me?.handle ?? accountLogin}
              results={publishResults}
            />
          ) : isReviewing && !isReviewLoading ? (
            <section className="flex flex-col gap-4">
              {error ? (
                <div className="rounded-[var(--radius-sm)] border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300">
                  {error}
                </div>
              ) : null}

              {orderedDrafts.map((draft) => {
                const key = getRepoKey(draft.repo);
                const issues = reviewIssuesByKey[key] ?? [];
                const slugResult = slugResults[toSlugQueryKey(key)];
                const isExpanded = expandedDraftKeys[key] || issues.length > 0;
                return (
                  <ReviewSkillCard
                    key={key}
                    draft={draft}
                    issues={issues}
                    slugResult={slugResult}
                    isExpanded={isExpanded}
                    isBusy={isBusy}
                    onToggleExpanded={() =>
                      setExpandedDraftKeys((current) => ({ ...current, [key]: !isExpanded }))
                    }
                    onChangeDraft={(patch) => updateDraft(key, patch)}
                    onToggleFile={(path) => updateDraftSelection(key, path)}
                    onApplyFileSelection={(mode) => applyFileSelection(key, mode)}
                  />
                );
              })}

              <Card>
                <CardContent className="gap-4">
                  <div>
                    <CardTitle>License</CardTitle>
                    <p className="text-sm text-[color:var(--ink-soft)]">
                      {PLATFORM_SKILL_LICENSE} &middot; {PLATFORM_SKILL_LICENSE_NAME}
                    </p>
                  </div>
                  <div className="space-y-1 text-sm text-[color:var(--ink-soft)]">
                    <p>
                      ClawHub records a supported license from package.json or LICENSE when present;
                      otherwise skills default to {PLATFORM_SKILL_LICENSE}.{" "}
                      {PLATFORM_SKILL_LICENSE_SUMMARY}
                    </p>
                    <p>
                      ClawHub does not support paid skills, per-skill pricing, or paywalled
                      releases.
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[linear-gradient(90deg,var(--surface-muted)_0%,var(--surface-muted)_68%,color-mix(in_srgb,var(--accent)_10%,var(--surface-muted))_100%)] p-3 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[color:var(--accent)]"
                      checked={acceptedLicenseTerms}
                      onChange={(event) => setAcceptedLicenseTerms(event.target.checked)}
                      disabled={isBusy}
                    />
                    <span>
                      I have the rights to publish{" "}
                      {orderedDrafts.length === 1 ? "this skill" : "these skills"} under the
                      declared or default ClawHub license.
                    </span>
                  </label>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div
                  className={[
                    "text-sm",
                    publishStatus.tone === "error"
                      ? "text-status-error-fg"
                      : "text-[color:var(--ink-soft)]",
                  ].join(" ")}
                >
                  {publishStatus.message}
                </div>
                <Button
                  variant="primary"
                  disabled={!canPublish}
                  loading={isBusy}
                  onClick={() => void publishReviewed()}
                >
                  {!canPublish && !isBusy ? <Lock className="h-4 w-4" aria-hidden="true" /> : null}
                  Publish selected
                </Button>
              </div>

              {publishResults.length > 0 ? <PublishResultList results={publishResults} /> : null}
            </section>
          ) : null}
        </div>
      </Container>
    </main>
  );
}

function PublishedImportSuccess({
  drafts,
  ownerHandle,
  results,
}: {
  drafts: ReviewDraft[];
  ownerHandle?: string | null;
  results: PublishResultRow[];
}) {
  const [copiedAllLinks, setCopiedAllLinks] = useState(false);
  const successfulResults = results.filter((result) => result.ok && result.slug);
  const draftByKey = new Map(drafts.map((draft) => [getRepoKey(draft.repo), draft]));
  const publishedItems = successfulResults.map((result) => {
    const draft = draftByKey.get(result.key);
    const slug = result.slug ?? "";
    const href = buildSkillHref(ownerHandle, slug);
    const url = buildSkillUrl(ownerHandle, slug);
    return { ...result, draft, href, url };
  });

  const copyAll = async () => {
    const text = publishedItems.map((item) => item.url).join("\n");
    const copied = await copyText(text);
    if (copied) {
      setCopiedAllLinks(true);
      window.setTimeout(() => setCopiedAllLinks(false), 1800);
      toast.success("Links copied");
    } else {
      toast.error("Could not copy links");
    }
  };

  return (
    <section className="github-import-success-panel overflow-hidden rounded-[var(--radius-md)] p-5 sm:p-7">
      <div className="mb-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="github-import-success-mark relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-status-success-fg">
            <CheckCircle2 className="h-7 w-7" strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-bold text-[color:var(--ink)]">
              They're alive! <span aria-hidden="true">🦞</span>
            </h2>
            <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
              {publishedItems.length} {publishedItems.length === 1 ? "skill" : "skills"} imported
              and ready to share.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void copyAll()}>
          {copiedAllLinks ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Copy className="h-4 w-4" aria-hidden="true" />
          )}
          {copiedAllLinks ? "Copied" : "Copy links"}
        </Button>
      </div>

      <div className="divide-y divide-[color:var(--line)] rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)]/70">
        {publishedItems.map((item) => {
          return (
            <div
              key={item.key}
              className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[linear-gradient(135deg,var(--surface-muted),var(--surface))] text-[color:var(--ink)]">
                  <Rocket className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                    {item.name}
                  </div>
                  <div className="truncate text-xs text-[color:var(--ink-soft)]">/{item.slug}</div>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2 sm:justify-end">
                <span className="min-w-0 truncate text-xs text-white/80">{item.url}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Copy ${item.name} link`}
                  onClick={() => {
                    void copyText(item.url).then((copied) => {
                      if (copied) toast.success("Link copied");
                      else toast.error("Could not copy link");
                    });
                  }}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button asChild variant="ghost" size="icon-sm" aria-label={`View ${item.name}`}>
                  <a href={item.href}>
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6">
        <a
          href={OPENCLAW_SKILLS_DISCORD_URL}
          target="_blank"
          rel="noreferrer"
          className="github-import-share-action flex items-center justify-between gap-4 rounded-[var(--radius-sm)] px-2 py-3 text-sm font-medium text-[color:var(--ink)] transition-colors hover:text-white"
        >
          <span className="flex min-w-0 items-center gap-3">
            <DiscordIcon className="h-4 w-4 shrink-0" />
            <span>Share on Discord</span>
            <span className="text-[color:var(--ink-soft)]">&middot;</span>
            <span className="truncate text-[color:var(--ink-soft)]">
              #skills / Friends of the Crustacean 🦞🤝
            </span>
          </span>
          <ExternalLink
            className="h-4 w-4 shrink-0 text-[color:var(--ink-soft)]"
            aria-hidden="true"
          />
        </a>
        <a
          href={buildXShareUrl(publishedItems)}
          target="_blank"
          rel="noreferrer"
          className="github-import-share-action flex items-center justify-between gap-4 rounded-[var(--radius-sm)] px-2 py-3 text-sm font-medium text-[color:var(--ink)] transition-colors hover:text-white"
        >
          <span className="flex min-w-0 items-center gap-3">
            <XIcon className="h-4 w-4 shrink-0" />
            <span>Share on Twitter</span>
          </span>
          <ExternalLink
            className="h-4 w-4 shrink-0 text-[color:var(--ink-soft)]"
            aria-hidden="true"
          />
        </a>
      </div>
    </section>
  );
}

function PublishResultList({ results }: { results: PublishResultRow[] }) {
  return (
    <div className="github-import-publish-results overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)]">
      {results.map((result) => {
        const Icon = result.ok ? CheckCircle2 : CircleX;
        return (
          <div key={result.key} className="github-import-publish-result-row">
            <div
              className={[
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                result.ok
                  ? "border-status-success-fg/25 bg-status-success-bg text-status-success-fg"
                  : "border-status-error-fg/25 bg-status-error-bg text-status-error-fg",
              ].join(" ")}
            >
              <Icon className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium text-[color:var(--ink)]">{result.name}</span>
                {result.ok && result.slug ? (
                  <span className="text-xs text-[color:var(--ink-soft)]">/{result.slug}</span>
                ) : null}
              </div>
              <p
                className={[
                  "mt-1 text-sm leading-6",
                  result.ok ? "text-[color:var(--ink-soft)]" : "text-status-error-fg",
                ].join(" ")}
              >
                {result.ok ? "Published." : normalizePublishResultMessage(result.message)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ImportStepper({
  current,
  onSelect,
  onReview,
  onPublish,
}: {
  current: 1 | 2 | 3;
  onSelect?: () => void;
  onReview?: () => void;
  onPublish?: () => void;
}) {
  const stepClass = (id: 1 | 2 | 3, isEnabled: boolean) =>
    [
      "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 transition-colors",
      current === id
        ? "border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 text-[color:var(--ink)]"
        : current > id
          ? "border-[color:var(--line)] text-[color:var(--ink)]"
          : "border-[color:var(--line)]",
      isEnabled ? "hover:border-[color:var(--border-ui-hover)]" : "opacity-55",
    ].join(" ");
  const stepButton = (
    id: 1 | 2 | 3,
    label: string,
    icon: ReactNode,
    onClick: (() => void) | undefined,
  ) => (
    <button
      type="button"
      className={stepClass(id, Boolean(onClick))}
      onClick={() => {
        if (onClick) onClick();
      }}
      aria-disabled={onClick ? undefined : true}
      aria-current={current === id ? "step" : undefined}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div className="flex w-full items-center gap-3 text-xs text-[color:var(--ink-soft)]">
      {stepButton(1, "Select", <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />, onSelect)}
      <span className="h-px flex-1 bg-[color:var(--line)]" aria-hidden="true" />
      {stepButton(2, "Review", <Eye className="h-3.5 w-3.5" aria-hidden="true" />, onReview)}
      <span className="h-px flex-1 bg-[color:var(--line)]" aria-hidden="true" />
      {stepButton(3, "Publish", <Rocket className="h-3.5 w-3.5" aria-hidden="true" />, onPublish)}
    </div>
  );
}

function LoadingPanel({ label, description }: { label: string; description: string }) {
  return (
    <Card className="min-h-[112px] justify-center">
      <CardContent className="flex-row items-center gap-4">
        <ClawHubSpinner />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[color:var(--ink)]">{label}</div>
          <div className="text-xs text-[color:var(--ink-soft)]">{description}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ClawHubSpinner() {
  return (
    <span className="clawhub-import-spinner" aria-hidden="true">
      <span className="clawhub-import-spinner-emoji" />
    </span>
  );
}

function ReviewSkillCard({
  draft,
  issues,
  slugResult,
  isExpanded,
  isBusy,
  onToggleExpanded,
  onChangeDraft,
  onToggleFile,
  onApplyFileSelection,
}: {
  draft: ReviewDraft;
  issues: string[];
  slugResult: SlugAvailabilityResult;
  isExpanded: boolean;
  isBusy: boolean;
  onToggleExpanded: () => void;
  onChangeDraft: (patch: Partial<ReviewDraft>) => void;
  onToggleFile: (path: string) => void;
  onApplyFileSelection: (mode: "skill" | "all") => void;
}) {
  const selectedCount = Object.values(draft.selected).filter(Boolean).length;
  const selectedBytes = draft.preview.files.reduce(
    (sum, file) => sum + (draft.selected[file.path] ? file.size : 0),
    0,
  );
  const slug = draft.slug.trim();
  const slugCollision =
    slug && !(slugResult instanceof Error)
      ? getPublicSlugCollision({ slug, result: slugResult })
      : null;
  const isSlugPending = Boolean(slug && SLUG_PATTERN.test(slug) && slugResult === undefined);
  const showSlugAvailableIcon =
    slug &&
    SLUG_PATTERN.test(slug) &&
    slugResult &&
    !(slugResult instanceof Error) &&
    slugResult.available &&
    !issues.some((issue) => issue.toLowerCase().includes("slug"));
  const showSlugUnavailableIcon = issues.some((issue) => issue.toLowerCase().includes("slug"));
  const suggestedCategories = useMemo(
    () =>
      resolveSkillCategories({
        inferred: inferSkillCategories({
          slug: draft.slug,
          displayName: draft.displayName,
          summary: draft.preview.candidate.description,
        }),
      }),
    [draft.displayName, draft.preview.candidate.description, draft.slug],
  );
  const fileSelectionMode = getFileSelectionMode(draft);
  const hasOptionalFiles = draft.preview.files.some(
    (file) => file.path !== draft.preview.candidate.readmePath,
  );
  const fieldIdPrefix = `github-import-${toSlugQueryKey(getRepoKey(draft.repo))}`;

  return (
    <Card className="github-import-review-card">
      <CardContent className="gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[color:var(--line)] text-[color:var(--ink-soft)]">
              <GitHubMark size={15} />
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs">
                <span className="font-medium text-[color:var(--ink)]">
                  {draft.repo.repoFullName}
                </span>
                <span className="text-[color:var(--ink-soft)]">
                  {" "}
                  &middot; {draft.preview.candidate.path || "repo root"}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleExpanded}
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
          >
            {selectedCount} {selectedCount === 1 ? "file" : "files"} selected
            <ChevronDown
              className={["h-3.5 w-3.5 transition-transform", isExpanded ? "rotate-180" : ""].join(
                " ",
              )}
              aria-hidden="true"
            />
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label
              htmlFor={`${fieldIdPrefix}-display`}
              className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--label-fg)]"
            >
              Display name
            </Label>
            <Input
              id={`${fieldIdPrefix}-display`}
              className="github-import-input"
              value={draft.displayName}
              onChange={(event) => onChangeDraft({ displayName: event.target.value })}
              disabled={isBusy}
              placeholder="Display name"
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Label
              htmlFor={`${fieldIdPrefix}-slug`}
              className="text-xs font-semibold uppercase tracking-[0.14em] text-[color:var(--label-fg)]"
            >
              Slug
            </Label>
            <div className="relative">
              <Input
                id={`${fieldIdPrefix}-slug`}
                className={[
                  "github-import-input",
                  showSlugAvailableIcon || showSlugUnavailableIcon || isSlugPending ? "pr-10" : "",
                ].join(" ")}
                value={draft.slug}
                onChange={(event) => onChangeDraft({ slug: event.target.value })}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={isBusy}
                placeholder="slug"
              />
              {isSlugPending ? (
                <span
                  aria-label="Checking slug availability"
                  className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-current/20 border-t-current text-[color:var(--ink-soft)]"
                />
              ) : null}
              {showSlugAvailableIcon ? (
                <Check
                  aria-label="Slug available"
                  className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-status-success-fg"
                />
              ) : null}
              {showSlugUnavailableIcon ? (
                <CircleX
                  aria-label="Slug unavailable"
                  className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-status-error-fg"
                />
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <CatalogMetadataFields
            kind="skill"
            idPrefix={fieldIdPrefix}
            categories={draft.categories}
            suggestedCategories={suggestedCategories}
            topics={draft.topics}
            disabled={isBusy}
            onCategoriesChange={(categories) => onChangeDraft({ categories })}
            onTopicsChange={(topics) => onChangeDraft({ topics })}
          />
        </div>

        {issues.length > 0 ? (
          <div className="rounded-[var(--radius-sm)] border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300">
            {issues[0]}
            {slugCollision?.url ? (
              <>
                {" "}
                <a href={slugCollision.url} className="underline">
                  View existing
                </a>
              </>
            ) : null}
          </div>
        ) : null}

        {isExpanded ? (
          <div className="flex flex-col gap-3 border-t border-[color:var(--line)] pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[color:var(--ink)]">Files</div>
                <div className="text-xs text-[color:var(--ink-soft)]">
                  {selectedCount} selected &middot; {formatBytes(selectedBytes)}
                </div>
              </div>
              {hasOptionalFiles ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isBusy}
                  onClick={() =>
                    onApplyFileSelection(fileSelectionMode === "skill" ? "all" : "skill")
                  }
                >
                  {fileSelectionMode === "skill" ? "Select all" : "Select only SKILL.md"}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-1">
              {draft.preview.files.map((file) => (
                <label
                  key={file.path}
                  className="flex items-center gap-3 rounded-[var(--radius-sm)] bg-[color:var(--surface-muted)] px-3 py-1.5 text-sm hover:bg-[color:var(--hover-bg)]"
                >
                  <input
                    type="checkbox"
                    checked={
                      file.path === draft.preview.candidate.readmePath || draft.selected[file.path]
                    }
                    onChange={() => onToggleFile(file.path)}
                    disabled={isBusy || file.path === draft.preview.candidate.readmePath}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[color:var(--ink-soft)]">
                    {file.path}
                  </span>
                  <span className="shrink-0 text-xs text-[color:var(--ink-soft)]">
                    {formatBytes(file.size)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function getPublishStatus({
  acceptedLicenseTerms,
  hasPendingSlugChecks,
  reviewIssuesByKey,
  status,
}: {
  acceptedLicenseTerms: boolean;
  hasPendingSlugChecks: boolean;
  reviewIssuesByKey: Record<string, string[]>;
  status: string | null;
}) {
  if (status) return { message: status, tone: "neutral" as const };
  if (hasPendingSlugChecks) {
    return { message: "Checking slug availability before publishing.", tone: "neutral" as const };
  }
  const firstIssue = Object.values(reviewIssuesByKey).find((issues) => issues.length > 0)?.[0];
  if (firstIssue) return { message: firstIssue, tone: "error" as const };
  if (!acceptedLicenseTerms) {
    return {
      message: "Accept the skill license confirmation before publishing.",
      tone: "error" as const,
    };
  }
  return { message: "Ready to publish.", tone: "neutral" as const };
}

function getFileSelectionMode(draft: ReviewDraft) {
  const readmePath = draft.preview.candidate.readmePath;
  const selectedPaths = draft.preview.files
    .filter((file) => file.path === readmePath || draft.selected[file.path])
    .map((file) => file.path);
  if (selectedPaths.length === draft.preview.files.length) return "all";
  if (selectedPaths.length === 1 && selectedPaths[0] === readmePath) return "skill";
  return "custom";
}

function getDraftIssues({
  draft,
  slugResult,
  isDuplicateSlug,
}: {
  draft: ReviewDraft;
  slugResult: SlugAvailabilityResult;
  isDuplicateSlug: boolean;
}) {
  const issues: string[] = [];
  const slug = draft.slug.trim().toLowerCase();
  if (!draft.displayName.trim()) issues.push("Display name is required.");
  if (!slug) {
    issues.push("Slug is required.");
  } else if (!SLUG_PATTERN.test(slug)) {
    issues.push("Slug must be lowercase and use dashes only.");
  } else if (isDuplicateSlug) {
    issues.push("Slug is duplicated in this import.");
  } else if (slugResult instanceof Error) {
    issues.push("Could not check slug availability.");
  } else {
    const collision = getPublicSlugCollision({ slug, result: slugResult });
    if (collision) issues.push(collision.message);
  }
  if (Object.values(draft.selected).filter(Boolean).length === 0) {
    issues.push("Select at least one file.");
  }
  if (!draft.selected[draft.preview.candidate.readmePath]) {
    issues.push("The skill file must stay selected.");
  }
  return issues;
}

function formatRepoDate(value: string | null | undefined) {
  if (!value) return "No recent activity";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "No recent activity";
  const elapsedMs = Date.now() - timestamp;
  if (elapsedMs < 60 * 1000) return "now";
  const elapsedHours = Math.floor(elapsedMs / (60 * 60 * 1000));
  if (elapsedHours < 24) return `${Math.max(1, elapsedHours)}h ago`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30) return `${elapsedDays}d ago`;
  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths}mo ago`;
  return `${Math.floor(elapsedMonths / 12)}y ago`;
}

function getRepoKey(repo: OwnedGitHubRepo) {
  return `${repo.fullName}:${repo.skillPath}`;
}

function mergeRepoLists(current: OwnedGitHubRepo[], incoming: OwnedGitHubRepo[]) {
  const byKey = new Map(current.map((repo) => [getRepoKey(repo), repo]));
  for (const repo of incoming) byKey.set(getRepoKey(repo), repo);
  return Array.from(byKey.values());
}

function getDevMockSkillCount() {
  if (!import.meta.env.DEV || typeof window === "undefined") return 0;
  const value = new URLSearchParams(window.location.search).get("mockSkills");
  const count = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(count, 50));
}

function expandDevMockSkillRepos(repos: OwnedGitHubRepo[]) {
  const count = getDevMockSkillCount();
  if (count <= repos.length || repos.length === 0) return repos;

  return Array.from({ length: count }, (_, index) => {
    const source = repos[index % repos.length] as OwnedGitHubRepo;
    const mockName = DEV_MOCK_SKILL_NAMES[index] ?? `${source.name}-${index + 1}`;
    return {
      ...source,
      name: mockName,
      fullName: `${source.fullName}#mock-${index + 1}`,
    };
  });
}

function toSlugQueryKey(key: string) {
  return `slug_${encodeURIComponent(key)}`;
}

function buildSkillHref(ownerHandle: string | null | undefined, slug: string) {
  const owner = ownerHandle?.trim() || "me";
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`;
}

function getPublicClawHubSiteUrl() {
  const configured = getClawHubSiteUrl();
  try {
    const hostname = new URL(configured).hostname;
    if (LOCAL_SHARE_HOSTS.has(hostname)) return PUBLIC_CLAWHUB_SITE_URL;
  } catch {
    return PUBLIC_CLAWHUB_SITE_URL;
  }
  return configured;
}

function buildSkillUrl(ownerHandle: string | null | undefined, slug: string) {
  const href = buildSkillHref(ownerHandle, slug);
  return new URL(href, getPublicClawHubSiteUrl()).toString();
}

function buildXShareUrl(items: Array<{ name: string; url: string }>) {
  const firstItem = items[0];
  const text =
    items.length <= 1
      ? `${firstItem?.name ?? "A skill"} is now live on ClawHub 🦞 Check it out: ${
          firstItem?.url ?? getPublicClawHubSiteUrl()
        }`
      : `${firstItem?.name ?? "A skill"} + ${items.length - 1} more ${
          items.length === 2 ? "skill" : "skills"
        } are now live on ClawHub 🦞 Check them out: ${firstItem?.url ?? getPublicClawHubSiteUrl()}`;
  const url = new URL("https://twitter.com/intent/tweet");
  url.searchParams.set("text", text);
  return url.toString();
}

function normalizePublishResultMessage(message: string | undefined) {
  const cleaned = (message ?? "Import failed")
    .replace(/^Import failed during publish:\s*/i, "")
    .replace(/^Uncaught ConvexError:\s*/i, "")
    .replace(/:\s*Uncaught ConvexError:\s*/i, ": ")
    .replace(/\s+at\s+[A-Za-z_$./(][\s\S]*$/i, "")
    .replace(/\s*Check skill format, slug availability, and try again\.?$/i, "")
    .trim();
  return cleaned || "Import failed";
}

function nextNumericSlug(value: string, used: Set<string>) {
  const root = value.trim().toLowerCase() || "skill";
  let candidate = root;
  let suffix = 2;
  while (!candidate || used.has(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function GitHubMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function DiscordIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>Discord</title>
      <path
        fill="currentColor"
        d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
      />
    </svg>
  );
}

function XIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      <title>X</title>
      <path
        fill="currentColor"
        d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z"
      />
    </svg>
  );
}
