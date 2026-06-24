import { useAuthActions } from "@convex-dev/auth/react";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import {
  getCatalogTopicSlugs,
  isPluginCategorySlug,
  isSkillCategorySlug,
  normalizeCatalogTopic,
  resolveStoredPluginCategories,
} from "clawhub-schema";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Download,
  Flag,
  MoreHorizontal,
  Search,
  Star,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  BrowseActions,
  BrowseControls,
  BrowseControlsDivider,
  BrowseControlsRow,
  BrowseSearchInput,
  BrowseSearchPanel,
  BrowseSearchTrigger,
  BrowseChipTabs,
  BrowseSegmentedTabs,
  BrowseSortSelect,
  useBrowseSearchDisclosure,
} from "../../components/BrowseControls";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { MarketplaceIcon } from "../../components/MarketplaceIcon";
import { OfficialBadge, OfficialTag } from "../../components/OfficialBadge";
import { PluginListItem } from "../../components/PluginListItem";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { SkillListItem } from "../../components/SkillListItem";
import { SkillReportDialog } from "../../components/SkillReportDialog";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Skeleton } from "../../components/ui/skeleton";
import { formatBrowseCount } from "../../lib/browseCount";
import {
  getSkillCategoriesForSkill,
  getSkillCategoryForSkill,
  PLUGIN_CATEGORIES,
  resolvePluginBrowseCategorySlug,
  resolveSkillBrowseCategorySlug,
  SKILL_CATEGORIES,
  type BrowseCategory,
} from "../../lib/categories";
import { formatCompactStat } from "../../lib/numberFormat";
import { buildPublisherMeta } from "../../lib/og";
import { buildPublisherProfileHref, isLegacyPublisherProfileHandle } from "../../lib/ownerRoute";
import type { PackageListItem } from "../../lib/packageApi";
import { packageNameFromPublisherPluginRoute } from "../../lib/pluginRoutes";
import type {
  PublicPublisher,
  PublicPublisherCatalogDisplay,
  PublicPublisherCatalogItem,
  PublicPublisherListItem,
  PublicSkill,
} from "../../lib/publicUser";
import { readPublicDownloadCount } from "../../lib/publicUser";
import { useAuthStatus } from "../../lib/useAuthStatus";

export const Route = createFileRoute("/user/$handle")({
  beforeLoad: ({ params }) => {
    if (isLegacyPublisherProfileHandle(params.handle)) return;

    throw redirect({
      href: buildPublisherProfileHref(params.handle),
      replace: true,
    });
  },
  loader: async ({ params }) => {
    const { convexHttp } = await import("../../convex/client");
    const publisher = (await convexHttp.query(api.publishers.getProfileByHandle, {
      handle: params.handle,
    })) as PublicPublisherListItem | null;
    if (!publisher) throw notFound();
    return { publisher };
  },
  head: ({ params, loaderData }) => {
    const publisher = loaderData?.publisher;
    const meta = buildPublisherMeta({
      handle: publisher?.handle ?? params.handle,
      displayName: publisher?.displayName,
      bio: publisher?.bio,
      image: publisher?.image,
      kind: publisher?.kind,
      downloads: publisher?.stats.downloads,
    });
    return {
      meta: [
        { title: meta.title },
        { name: "description", content: meta.description },
        { property: "og:title", content: meta.title },
        { property: "og:description", content: meta.description },
        { property: "og:url", content: meta.url },
        { property: "og:image", content: meta.image },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: meta.title },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: meta.title },
        { name: "twitter:description", content: meta.description },
        { name: "twitter:image", content: meta.image },
      ],
      links: [{ rel: "canonical", href: meta.url }],
    };
  },
  component: PublisherProfile,
});

type PublisherMemberResult = {
  publisher: PublicPublisher | null;
  members: Array<{
    role: "owner" | "admin" | "publisher";
    user: {
      _id: string;
      handle: string | null;
      displayName: string | null;
      image: string | null;
      official: boolean;
    };
  }>;
};

type ProfileCatalogTab = "skills" | "plugins" | "stars";
type ProfileCatalogSort = "downloads" | "recent" | "stars";

const VISIBLE_ORG_CHIPS = 2;
const VISIBLE_MEMBER_STACK = 8;
const CATALOG_SEARCH_THRESHOLD = 8;
const PUBLISHER_REPORT_DISCORD_URL = "https://discord.gg/clawd";
const DEFAULT_PUBLISHER_BIO = "Publisher on Clawhub.";

const PROFILE_CATALOG_SORT_OPTIONS = [
  { value: "downloads", label: "Most downloaded" },
  { value: "recent", label: "Recent" },
  { value: "stars", label: "Stars" },
] as const;

const DEFAULT_PROFILE_CATALOG_SORT: ProfileCatalogSort = "downloads";

function formatCatalogTabCount(value: number) {
  return formatBrowseCount(value) ?? formatCompactStat(value);
}

export function resolveDefaultCatalogTab(
  publisher: Pick<PublicPublisherListItem, "stats">,
): Extract<ProfileCatalogTab, "skills" | "plugins"> {
  if (publisher.stats.skills > 0) return "skills";
  if (publisher.stats.packages > 0) return "plugins";
  return "skills";
}

function buildCatalogTabOptions(publisher: PublicPublisherListItem) {
  const options = [
    {
      value: "skills",
      label: "Skills",
      count: formatCatalogTabCount(publisher.stats.skills),
    },
    {
      value: "plugins",
      label: "Plugins",
      count: formatCatalogTabCount(publisher.stats.packages),
    },
  ];
  if (publisher.kind === "user") {
    options.push({
      value: "stars",
      label: "Starred",
      count: formatCatalogTabCount(publisher.starredCount ?? 0),
    });
  }
  return options;
}

function GitHubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function PublisherProfileBio({ bio }: { bio: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const bioRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    setExpanded(false);
  }, [bio]);

  useLayoutEffect(() => {
    const node = bioRef.current;
    if (!node) return undefined;

    const measure = () => {
      if (expanded) {
        setCanExpand(true);
        return;
      }
      setCanExpand(node.scrollHeight > node.clientHeight + 1);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [bio, expanded]);

  return (
    <div className="publisher-profile-bio-block">
      <p ref={bioRef} className={`publisher-profile-bio${expanded ? "" : " is-clamped"}`}>
        {bio}
      </p>
      {canExpand ? (
        <button
          type="button"
          className="publisher-profile-bio-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Show less" : "See more"}
        </button>
      ) : null}
    </div>
  );
}

type PublisherMemberEntry = PublisherMemberResult["members"][number];

type PublisherStatCard = {
  key: string;
  value: string;
  label: string;
  icon: LucideIcon;
};

export function buildPublisherStatCards(publisher: PublicPublisherListItem): PublisherStatCard[] {
  return [
    {
      key: "downloads",
      value: formatCompactStat(publisher.stats.downloads),
      label: "downloads",
      icon: Download,
    },
    {
      key: "stars",
      value: formatCompactStat(publisher.stats.stars),
      label: "stars",
      icon: Star,
    },
  ];
}

function PublisherProfileStatCards({ cards }: { cards: PublisherStatCard[] }) {
  return (
    <dl className="publisher-profile-stat-cards" aria-label="Publisher stats">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.key} className="publisher-profile-stat">
            <Icon size={16} aria-hidden="true" className="publisher-profile-stat-icon" />
            <dd className="publisher-profile-stat-value">{card.value}</dd>
            <dt className="publisher-profile-stat-label">{card.label}</dt>
          </div>
        );
      })}
    </dl>
  );
}

function PublisherProfileMemberMenuRow({
  entry,
  publisherHandle,
  showRole,
}: {
  entry: PublisherMemberEntry;
  publisherHandle: string;
  showRole: boolean;
}) {
  const name = entry.user.displayName ?? entry.user.handle ?? "User";

  return (
    <Link
      to="/user/$handle"
      params={{ handle: entry.user.handle ?? publisherHandle }}
      className="publisher-profile-member-menu-row"
    >
      <MarketplaceIcon kind="user" label={name} imageUrl={entry.user.image} size="xs" />
      <span
        className={`publisher-profile-member-menu-copy${showRole ? "" : " publisher-profile-member-menu-copy-single"}`}
      >
        <span className="publisher-profile-member-menu-name">
          {name}
          {entry.user.official ? <OfficialBadge /> : null}
        </span>
        {showRole ? <span className="publisher-profile-member-menu-role">{entry.role}</span> : null}
      </span>
      <ArrowRight size={14} aria-hidden="true" className="publisher-profile-member-menu-arrow" />
    </Link>
  );
}

function PublisherProfileMembers({
  members,
  publisherHandle,
  showMemberRoles,
}: {
  members: PublisherMemberEntry[];
  publisherHandle: string;
  showMemberRoles: boolean;
}) {
  const stackMembers = members.slice(0, VISIBLE_MEMBER_STACK);
  const hiddenMemberCount = Math.max(0, members.length - VISIBLE_MEMBER_STACK);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="publisher-profile-members-trigger"
          aria-label={`Show ${members.length} members`}
        >
          <span className="publisher-profile-member-avatar-stack" aria-hidden="true">
            {stackMembers.map((entry, index) => {
              const name = entry.user.displayName ?? entry.user.handle ?? "User";
              return (
                <span
                  key={`${entry.user._id}:${entry.role}`}
                  className="publisher-profile-member-avatar-stack-item"
                  style={{ zIndex: stackMembers.length - index }}
                  title={name}
                >
                  <MarketplaceIcon kind="user" label={name} imageUrl={entry.user.image} size="xs" />
                </span>
              );
            })}
          </span>
          {hiddenMemberCount > 0 ? (
            <span className="publisher-profile-members-more">+{hiddenMemberCount} more</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="publisher-profile-members-menu !overflow-hidden !rounded-2xl p-0 shadow-none"
        aria-label={`${members.length} members`}
      >
        <div className="publisher-profile-members-menu-list">
          {members.map((entry) => (
            <DropdownMenuItem key={`${entry.user._id}:${entry.role}`} asChild>
              <PublisherProfileMemberMenuRow
                entry={entry}
                publisherHandle={publisherHandle}
                showRole={showMemberRoles}
              />
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PublisherProfile() {
  const { handle } = Route.useParams();
  const { publisher: loaderPublisher } = Route.useLoaderData() as {
    publisher: PublicPublisherListItem;
  };
  return <PublisherProfilePage handle={handle} loaderPublisher={loaderPublisher} />;
}

function PublisherProfileChromeActions({
  isAuthenticated,
  onReport,
  requireSignIn,
}: {
  isAuthenticated: boolean;
  onReport: () => void;
  requireSignIn: () => void;
}) {
  return (
    <div className="publisher-profile-chrome-actions">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Profile actions"
            className="publisher-profile-chrome-more-trigger rounded-full focus-visible:ring-0 focus-visible:ring-offset-0"
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="publisher-profile-chrome-more-menu">
          <DropdownMenuItem
            onSelect={() => {
              if (!isAuthenticated) {
                requireSignIn();
                return;
              }
              onReport();
            }}
          >
            <Flag size={14} aria-hidden="true" />
            Report profile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PublisherProfileChromeIdentity({ publisher }: { publisher: PublicPublisherListItem }) {
  return (
    <div className="publisher-profile-chrome-identity">
      <div className="publisher-profile-avatar">
        <MarketplaceIcon
          kind={publisher.kind === "org" ? "org" : "user"}
          label={publisher.displayName}
          imageUrl={publisher.image}
          size="md"
        />
      </div>
      <div className="publisher-profile-heading">
        <div className="publisher-profile-title-row">
          <h1>
            <span className="publisher-profile-title-text">{publisher.displayName}</span>
          </h1>
          {publisher.official ? (
            <OfficialTag className="publisher-profile-title-official-tag" />
          ) : null}
        </div>
        <span className="publisher-profile-handle-row">
          <span className="publisher-profile-handle">@{publisher.handle}</span>
          {publisher.official ? (
            <OfficialBadge className="publisher-profile-handle-official-badge" />
          ) : null}
        </span>
      </div>
    </div>
  );
}

export function PublisherProfilePage({
  handle,
  loaderPublisher,
}: {
  handle: string;
  loaderPublisher: PublicPublisherListItem;
}) {
  const { isAuthenticated } = useAuthStatus();
  const { signIn } = useAuthActions();
  const [catalogTab, setCatalogTab] = useState<ProfileCatalogTab>(() =>
    resolveDefaultCatalogTab(loaderPublisher),
  );
  useEffect(() => {
    setCatalogTab(resolveDefaultCatalogTab(loaderPublisher));
  }, [handle, loaderPublisher]);
  const [catalogSort, setCatalogSort] = useState<ProfileCatalogSort>(DEFAULT_PROFILE_CATALOG_SORT);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedCatalogGroup, setSelectedCatalogGroup] = useState("all");
  const [showAllOrgs, setShowAllOrgs] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const browseSearch = useBrowseSearchDisclosure({
    value: catalogSearch,
    onClear: () => setCatalogSearch(""),
    inputRef: searchInputRef,
  });

  const activeCatalogSort = catalogSort === DEFAULT_PROFILE_CATALOG_SORT ? undefined : catalogSort;

  const apiSort = catalogSort === "stars" ? "downloads" : catalogSort;

  const publishedQueryArgs = useMemo(() => {
    const base = { handle, sort: apiSort as "downloads" | "recent" };
    if (catalogTab === "plugins") return { ...base, kind: "plugin" as const };
    return { ...base, kind: "skill" as const };
  }, [handle, catalogTab, apiSort]);

  const queriedPublisher = useQuery(api.publishers.getProfileByHandle, { handle }) as
    | PublicPublisherListItem
    | null
    | undefined;
  const publisher = queriedPublisher === undefined ? loaderPublisher : queriedPublisher;

  const publishedDisplay = useQuery(
    api.publishers.getPublishedDisplayManifest,
    catalogTab === "skills" ? publishedQueryArgs : "skip",
  ) as PublicPublisherCatalogDisplay | null | undefined;

  const members = useQuery(api.publishers.listMembers, { publisherHandle: handle }) as
    | PublisherMemberResult
    | null
    | undefined;

  const myPublisherMemberships = useQuery(
    api.publishers.listMine,
    isAuthenticated ? {} : "skip",
  ) as Array<{ publisher: { handle: string; kind: "user" | "org" }; role: string }> | undefined;

  const viewerCanSeeMemberRoles = useMemo(() => {
    if (!myPublisherMemberships) return false;
    return myPublisherMemberships.some(
      (entry) =>
        entry.publisher.kind === "org" &&
        entry.publisher.handle === handle &&
        (entry.role === "owner" || entry.role === "admin"),
    );
  }, [myPublisherMemberships, handle]);

  const {
    results: publishedResults,
    status: publishedStatus,
    loadMore,
  } = usePaginatedQuery(api.publishers.listPublishedPage, publishedQueryArgs, {
    initialNumItems: 12,
  });

  const {
    results: starredResults,
    status: starredStatus,
    loadMore: loadMoreStarred,
  } = usePaginatedQuery(
    api.publishers.listStarredPage,
    { handle, sort: apiSort },
    { initialNumItems: 12 },
  );

  const publishedItems = (publishedResults ?? []) as PublicPublisherCatalogItem[];
  const starredItems = (starredResults ?? []) as PublicPublisherCatalogItem[];
  const activeItems = catalogTab === "stars" ? starredItems : publishedItems;

  const sortedItems = useMemo(() => {
    if (catalogSort !== "stars") return activeItems;
    return [...activeItems].sort(
      (left, right) =>
        right.stars - left.stars ||
        readPublicDownloadCount(right) - readPublicDownloadCount(left) ||
        right.updatedAt - left.updatedAt,
    );
  }, [activeItems, catalogSort]);

  const filteredItems = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return sortedItems;
    return sortedItems.filter((item) => {
      const haystack = `${item.displayName} ${item.summary ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [catalogSearch, sortedItems]);

  const activePublishedDisplay = catalogTab === "skills" ? publishedDisplay : null;

  const catalogGroups = useMemo(() => {
    if (catalogTab === "stars") return [];
    if (activePublishedDisplay && catalogSearch.trim().length === 0) {
      return displaySectionsToCatalogGroups(activePublishedDisplay);
    }
    return groupPublisherCatalogItemsByTopic(filteredItems);
  }, [activePublishedDisplay, catalogSearch, catalogTab, filteredItems]);

  useEffect(() => {
    setSelectedCatalogGroup("all");
  }, [catalogTab, catalogSearch]);

  const closeReportDialog = () => {
    setIsReportDialogOpen(false);
    setReportReason("");
    setReportError(null);
    setIsSubmittingReport(false);
  };

  const openReportDialog = () => {
    setReportReason("");
    setReportError(null);
    setIsSubmittingReport(false);
    setIsReportDialogOpen(true);
  };

  const submitPublisherReport = async (reportedPublisher: PublicPublisherListItem) => {
    const trimmedReason = reportReason.trim();
    if (!trimmedReason) {
      setReportError("Report reason required.");
      return;
    }

    setIsSubmittingReport(true);
    setReportError(null);
    try {
      const reportText = [
        `Publisher report: @${reportedPublisher.handle}`,
        `Name: ${reportedPublisher.displayName}`,
        `Profile: ${window.location.href}`,
        "",
        trimmedReason,
      ].join("\n");
      await navigator.clipboard.writeText(reportText);
      window.open(PUBLISHER_REPORT_DISCORD_URL, "_blank", "noopener,noreferrer");
      closeReportDialog();
      toast.success("Report copied. Paste it for moderators on Discord.");
    } catch (error) {
      console.error("Failed to prepare publisher report", error);
      setReportError("Could not copy the report. Try again.");
      setIsSubmittingReport(false);
    }
  };

  if (publisher === undefined) {
    return (
      <main className="publisher-profile-route py-10">
        <Container className="publisher-profile-container">
          <div className="publisher-profile-page">
            <div className="publisher-profile-chrome">
              <div className="publisher-profile-chrome-inner">
                <Skeleton className="h-[72px] w-[72px] rounded-[var(--r-md)]" />
                <div className="publisher-profile-heading">
                  <Skeleton className="h-8 w-56" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-80 max-w-full" />
                </div>
              </div>
            </div>
            <BrowseResultsSkeleton count={6} showColumnHead={false} variant="list" />
          </div>
        </Container>
      </main>
    );
  }

  if (!publisher) {
    return (
      <main className="publisher-profile-route py-10">
        <Container className="publisher-profile-container">
          <EmptyState
            icon={Building2}
            title="Publisher not found"
            description="This publisher doesn't exist or may have been removed."
            action={{ label: "Browse creators", href: "/creators" }}
          />
        </Container>
      </main>
    );
  }

  const affiliations = publisher.affiliations ?? [];
  const memberEntries = members?.members ?? [];
  const activeStatus = catalogTab === "stars" ? starredStatus : publishedStatus;
  const activeLoadMore = catalogTab === "stars" ? loadMoreStarred : loadMore;
  const isLoadingCatalog = activeStatus === "LoadingFirstPage";
  const catalogCount =
    catalogTab === "stars"
      ? (publisher.starredCount ?? starredItems.length)
      : catalogTab === "plugins"
        ? publisher.stats.packages
        : publisher.stats.skills;
  const showCatalogSearch = catalogCount >= CATALOG_SEARCH_THRESHOLD;
  const catalogTabOptions = buildCatalogTabOptions(publisher);

  const showCatalogLoadMore = shouldShowPublisherCatalogLoadMore({
    activeStatus,
    catalogSearch,
    selectedCatalogGroup,
    activePublishedDisplay,
  });

  const visibleOrgs = showAllOrgs ? affiliations : affiliations.slice(0, VISIBLE_ORG_CHIPS);
  const hiddenOrgCount = Math.max(0, affiliations.length - VISIBLE_ORG_CHIPS);
  const showOrganizations = publisher.kind === "user" && affiliations.length > 0;
  const showMembers = publisher.kind === "org" && memberEntries.length > 0;
  const publisherStatCards = buildPublisherStatCards(publisher);
  const profileBio = publisher.bio?.trim() || DEFAULT_PUBLISHER_BIO;

  return (
    <main className="publisher-profile-route">
      <Container className="publisher-profile-container">
        <div className="publisher-profile-page">
          <section className="publisher-profile-chrome" aria-label="Publisher profile">
            <div className="publisher-profile-chrome-top">
              <PublisherProfileChromeIdentity publisher={publisher} />
              <PublisherProfileChromeActions
                isAuthenticated={isAuthenticated}
                onReport={openReportDialog}
                requireSignIn={() => {
                  void signIn("github");
                }}
              />
            </div>

            <div className="publisher-profile-chrome-divider" aria-hidden="true" />

            <div className="publisher-profile-chrome-body">
              <div className="publisher-profile-chrome-content">
                <div className="publisher-profile-about-row">
                  <section className="publisher-profile-detail-block" aria-label="About">
                    <h2 className="publisher-profile-detail-label">About</h2>
                    <PublisherProfileBio bio={profileBio} />
                  </section>
                  <PublisherProfileStatCards cards={publisherStatCards} />
                </div>

                <div className="publisher-profile-details-inline">
                  {showMembers ? (
                    <section
                      className="publisher-profile-detail-block publisher-profile-detail-block-fit publisher-profile-details-members"
                      aria-label="Members"
                    >
                      <h2 className="publisher-profile-detail-label">Members</h2>
                      <PublisherProfileMembers
                        members={memberEntries}
                        publisherHandle={publisher.handle}
                        showMemberRoles={viewerCanSeeMemberRoles}
                      />
                    </section>
                  ) : null}

                  {showOrganizations ? (
                    <section
                      className="publisher-profile-detail-block publisher-profile-detail-block-fit publisher-profile-details-organizations"
                      aria-label="Organizations"
                    >
                      <h2 className="publisher-profile-detail-label">Organizations</h2>
                      <div className="publisher-profile-meta-chips">
                        {visibleOrgs.map((entry) => (
                          <Link
                            key={entry.publisher._id}
                            to="/user/$handle"
                            params={{ handle: entry.publisher.handle }}
                            className="publisher-profile-meta-chip"
                          >
                            <MarketplaceIcon
                              kind="org"
                              label={entry.publisher.displayName}
                              imageUrl={entry.publisher.image}
                              size="xs"
                            />
                            <span className="publisher-profile-meta-chip-copy">
                              <strong>{entry.publisher.displayName}</strong>
                              <small>{entry.role}</small>
                            </span>
                          </Link>
                        ))}
                        {!showAllOrgs && hiddenOrgCount > 0 ? (
                          <button
                            type="button"
                            className="publisher-profile-meta-chip publisher-profile-meta-chip-more"
                            onClick={() => setShowAllOrgs(true)}
                          >
                            +{hiddenOrgCount}
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  <section
                    className="publisher-profile-detail-block publisher-profile-details-links"
                    aria-label="Links"
                  >
                    <h2 className="publisher-profile-detail-label">Links</h2>
                    <div className="publisher-profile-meta-row">
                      <a
                        className="publisher-profile-meta-link"
                        href={`https://github.com/${publisher.handle}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <GitHubIcon size={14} />
                        GitHub
                        <ArrowUpRight
                          className="publisher-profile-meta-link-external-icon"
                          size={12}
                          aria-hidden="true"
                        />
                      </a>
                    </div>
                  </section>
                </div>
              </div>
            </div>
          </section>

          <div className="publisher-profile-tab-bar">
            <BrowseControls>
              <BrowseControlsRow>
                <BrowseSegmentedTabs
                  ariaLabel="Catalog"
                  options={catalogTabOptions}
                  value={catalogTab}
                  onChange={(value) => {
                    if (!value) return;
                    setCatalogTab(value as ProfileCatalogTab);
                    setCatalogSearch("");
                  }}
                />
                <BrowseActions>
                  <BrowseSortSelect
                    options={PROFILE_CATALOG_SORT_OPTIONS}
                    value={activeCatalogSort}
                    onChange={(value) =>
                      setCatalogSort((value ?? DEFAULT_PROFILE_CATALOG_SORT) as ProfileCatalogSort)
                    }
                  />
                  {showCatalogSearch ? (
                    <>
                      <BrowseControlsDivider />
                      <BrowseSearchTrigger
                        open={browseSearch.open}
                        onOpen={browseSearch.openSearch}
                        label="Filter catalog"
                      />
                    </>
                  ) : null}
                </BrowseActions>
                {showCatalogSearch ? (
                  <BrowseSearchPanel open={browseSearch.open}>
                    <BrowseSearchInput
                      inputRef={searchInputRef}
                      label="catalog search"
                      placeholder="Filter items..."
                      value={catalogSearch}
                      onChange={setCatalogSearch}
                      onClear={browseSearch.closeSearch}
                      closeLabel="Close search"
                    />
                  </BrowseSearchPanel>
                ) : null}
              </BrowseControlsRow>
            </BrowseControls>
          </div>

          <div className="publisher-profile-catalog-panel">
            <section
              className="publisher-profile-catalog browse-page"
              aria-label="Publisher catalog"
            >
              {isLoadingCatalog ? (
                <BrowseResultsSkeleton count={6} showColumnHead={false} variant="list" />
              ) : catalogGroups.length > 1 ? (
                <PublisherGroupedCatalog
                  groups={catalogGroups}
                  selectedGroup={selectedCatalogGroup}
                  onSelectedGroupChange={setSelectedCatalogGroup}
                  footer={
                    showCatalogLoadMore ? (
                      <div className="publisher-profile-load-more">
                        <Button type="button" onClick={() => activeLoadMore(12)}>
                          Load more
                        </Button>
                      </div>
                    ) : activeStatus === "LoadingMore" ? (
                      <div className="publisher-profile-loading">Loading more...</div>
                    ) : null
                  }
                />
              ) : filteredItems.length > 0 ? (
                <>
                  <PublisherCatalogItems items={filteredItems} />
                  {showCatalogLoadMore ? (
                    <div className="publisher-profile-load-more">
                      <Button type="button" onClick={() => activeLoadMore(12)}>
                        Load more
                      </Button>
                    </div>
                  ) : null}
                  {activeStatus === "LoadingMore" ? (
                    <div className="publisher-profile-loading">Loading more...</div>
                  ) : null}
                </>
              ) : (
                <EmptyState
                  icon={catalogSearch.trim().length > 0 ? Search : undefined}
                  title={
                    catalogSearch.trim().length > 0
                      ? "No matching items"
                      : catalogTab === "stars"
                        ? "No starred items yet"
                        : catalogTab === "plugins"
                          ? "No published plugins yet"
                          : "No published skills yet"
                  }
                />
              )}
            </section>
          </div>
        </div>
      </Container>

      <SkillReportDialog
        isOpen={isAuthenticated && isReportDialogOpen}
        isSubmitting={isSubmittingReport}
        reportReason={reportReason}
        reportError={reportError}
        title="Report profile"
        description="Describe the issue so moderators can review this publisher."
        submitLabel="Copy report"
        onReasonChange={setReportReason}
        onCancel={closeReportDialog}
        onSubmit={() => void submitPublisherReport(publisher)}
      />
    </main>
  );
}

const UNCATEGORIZED_GROUP_KEY = "other";
const UNCATEGORIZED_GROUP_TITLE = "Uncategorized";

export function getPublisherCatalogItemCategorySlugs(item: PublicPublisherCatalogItem): string[] {
  const slugs = new Set<string>();
  if (item.kind === "skill") {
    for (const category of getSkillCategoriesForSkill({
      slug: item.slug ?? parseCatalogItemSlug(item),
      displayName: item.displayName,
      summary: item.summary,
      categories: item.categories,
      inferredCategories: item.inferredCategories,
      latestVersionId: item.latestVersionId,
      inferredFromVersionId: item.inferredFromVersionId,
    })) {
      slugs.add(category.slug);
    }
  } else {
    for (const slug of resolveStoredPluginCategories({
      categories: item.categories,
      inferredCategories: item.inferredCategories,
      displayName: item.displayName,
      summary: item.summary ?? undefined,
    })) {
      slugs.add(slug);
    }
    for (const raw of item.categories ?? []) {
      const resolved = resolvePluginBrowseCategorySlug(raw);
      if (resolved) slugs.add(resolved);
    }
  }
  const isCategorySlug = item.kind === "skill" ? isSkillCategorySlug : isPluginCategorySlug;
  for (const topicSlug of getCatalogTopicSlugs(item.topics)) {
    if (isCategorySlug(topicSlug)) slugs.add(topicSlug);
  }
  return [...slugs];
}

export function publisherCatalogItemMatchesCategory(
  item: PublicPublisherCatalogItem,
  categorySlug: string,
): boolean {
  const resolved =
    item.kind === "skill"
      ? resolveSkillBrowseCategorySlug(categorySlug)
      : resolvePluginBrowseCategorySlug(categorySlug);
  if (!resolved) return false;
  return getPublisherCatalogItemCategorySlugs(item).includes(resolved);
}

export function buildPublisherCatalogCategoryOptions(
  items: readonly PublicPublisherCatalogItem[],
  kind: "skill" | "plugin",
): BrowseCategory[] {
  const source = kind === "plugin" ? PLUGIN_CATEGORIES : SKILL_CATEGORIES;
  const presentSlugs = new Set(items.flatMap((item) => getPublisherCatalogItemCategorySlugs(item)));
  return source.filter((category) => presentSlugs.has(category.slug));
}

export type PublisherCatalogGroup = {
  key: string;
  title: string;
  description?: string | null;
  items: PublicPublisherCatalogItem[];
};

export function displaySectionsToCatalogGroups(
  display: PublicPublisherCatalogDisplay,
): PublisherCatalogGroup[] {
  return display.sections.map((section) => ({
    key: section.key,
    title: section.title === "Other" ? UNCATEGORIZED_GROUP_TITLE : section.title,
    description: section.description,
    items: section.items,
  }));
}

export function groupPublisherCatalogItemsByTopic(
  items: PublicPublisherCatalogItem[],
): PublisherCatalogGroup[] {
  const groups = new Map<string, { title: string; items: PublicPublisherCatalogItem[] }>();
  for (const item of items) {
    const rawTopic = item.topics?.[0]?.trim();
    const title = rawTopic || UNCATEGORIZED_GROUP_TITLE;
    const key = rawTopic
      ? (normalizeCatalogTopic(rawTopic) ?? rawTopic.toLocaleLowerCase("en-US"))
      : UNCATEGORIZED_GROUP_KEY;
    const group = groups.get(key) ?? { title, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((left, right) => {
      if (left.key === UNCATEGORIZED_GROUP_KEY) return 1;
      if (right.key === UNCATEGORIZED_GROUP_KEY) return -1;
      return left.title.localeCompare(right.title);
    });
}

export function buildPublisherGroupTabOptions(groups: PublisherCatalogGroup[]) {
  const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  return [
    { value: "all", label: "All", count: formatCatalogTabCount(totalCount) },
    ...groups.map((group) => ({
      value: group.key,
      label: group.title,
      count: formatCatalogTabCount(group.items.length),
    })),
  ];
}

export function shouldShowPublisherCatalogLoadMore({
  activeStatus,
  catalogSearch: _catalogSearch,
  selectedCatalogGroup,
  activePublishedDisplay,
}: {
  activeStatus: string;
  catalogSearch: string;
  selectedCatalogGroup: string;
  activePublishedDisplay: PublicPublisherCatalogDisplay | null | undefined;
}) {
  return (
    activeStatus === "CanLoadMore" && selectedCatalogGroup === "all" && !activePublishedDisplay
  );
}

function PublisherCatalogItems({ items }: { items: PublicPublisherCatalogItem[] }) {
  return (
    <div className="browse-list-stack">
      <div className="results-list">
        {items.map((item) => (
          <PublishedItemCard key={`${item.kind}:${item._id}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function PublisherCatalogGroupSection({ group }: { group: PublisherCatalogGroup }) {
  return (
    <section
      className="publisher-profile-manifest-section"
      aria-labelledby={`catalog-group-${group.key}`}
    >
      <header className="publisher-profile-manifest-heading">
        <h3 id={`catalog-group-${group.key}`}>{group.title}</h3>
        {group.description ? <p>{group.description}</p> : null}
      </header>
      <PublisherCatalogItems items={group.items} />
    </section>
  );
}

export function PublisherGroupedCatalog({
  groups,
  selectedGroup,
  onSelectedGroupChange,
  footer,
}: {
  groups: PublisherCatalogGroup[];
  selectedGroup: string;
  onSelectedGroupChange: (value: string) => void;
  footer?: ReactNode;
}) {
  const activeGroup =
    selectedGroup === "all" ? null : (groups.find((group) => group.key === selectedGroup) ?? null);
  const groupTabOptions = buildPublisherGroupTabOptions(groups);

  return (
    <div className="publisher-profile-grouped-catalog">
      <div className="publisher-profile-group-tabs">
        <BrowseChipTabs
          ariaLabel="Catalog groups"
          options={groupTabOptions}
          value={selectedGroup}
          onChange={(value) => {
            if (!value) return;
            onSelectedGroupChange(value);
          }}
        />
      </div>
      {selectedGroup === "all" ? (
        <div className="publisher-profile-catalog-sections">
          {groups.map((group) => (
            <PublisherCatalogGroupSection key={group.key} group={group} />
          ))}
        </div>
      ) : activeGroup ? (
        <PublisherCatalogGroupSection group={activeGroup} />
      ) : null}
      {footer}
    </div>
  );
}

export function formatRelativeUpdatedAt(timestampMs: number, now = Date.now()) {
  const diffMs = Math.max(0, now - timestampMs);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

// Exported for unit testing. The publisher profile route is the only
// production consumer; tests assert that custom skill icons forwarded via
// `item.icon` reach `MarketplaceIcon`.
export function PublishedCatalogSections({
  display,
  selectedGroup = "all",
  onSelectedGroupChange,
  footer,
}: {
  display: PublicPublisherCatalogDisplay;
  selectedGroup?: string;
  onSelectedGroupChange?: (value: string) => void;
  footer?: ReactNode;
}) {
  const groups = displaySectionsToCatalogGroups(display);
  const [internalSelectedGroup, setInternalSelectedGroup] = useState("all");
  const activeSelectedGroup = onSelectedGroupChange ? selectedGroup : internalSelectedGroup;
  const handleSelectedGroupChange = onSelectedGroupChange ?? setInternalSelectedGroup;

  if (groups.length <= 1) {
    const items = groups[0]?.items ?? [];
    return (
      <>
        <PublisherCatalogItems items={items} />
        {footer}
      </>
    );
  }

  return (
    <PublisherGroupedCatalog
      groups={groups}
      selectedGroup={activeSelectedGroup}
      onSelectedGroupChange={handleSelectedGroupChange}
      footer={footer}
    />
  );
}

export function getCatalogItemTypeLabel(item: PublicPublisherCatalogItem) {
  if (item.kind === "plugin") return "Plugin";
  const category = getSkillCategoryForSkill({
    slug: item.slug ?? item._id,
    displayName: item.displayName,
    summary: item.summary,
    categories: item.categories,
    inferredCategories: item.inferredCategories,
    latestVersionId: item.latestVersionId,
    inferredFromVersionId: item.inferredFromVersionId,
  });
  const subtype = item.topics?.[0]?.trim() || category?.label || UNCATEGORIZED_GROUP_TITLE;
  return `Skill · ${subtype}`;
}

export function getCatalogItemShortTypeLabel(item: PublicPublisherCatalogItem) {
  if (item.kind === "plugin") return "plugin";
  if (item.topics?.[0]?.trim()) return item.topics[0].trim().toLowerCase();
  const category = getSkillCategoryForSkill({
    slug: item.slug ?? item._id,
    displayName: item.displayName,
    summary: item.summary,
    categories: item.categories,
    inferredCategories: item.inferredCategories,
    latestVersionId: item.latestVersionId,
    inferredFromVersionId: item.inferredFromVersionId,
  });
  return (category?.label ?? UNCATEGORIZED_GROUP_TITLE).toLowerCase();
}

function parseCatalogItemSlug(item: PublicPublisherCatalogItem) {
  if (item.slug?.trim()) return item.slug.trim();
  const segments = item.href.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? item._id;
}

export function parsePluginCatalogRoute(item: PublicPublisherCatalogItem): {
  name: string;
  ownerHandle?: string;
} {
  const segments = item.href.split("/").filter(Boolean);
  const pluginsIndex = segments.indexOf("plugins");
  if (pluginsIndex < 0) {
    return { name: parseCatalogItemSlug(item) };
  }

  const pluginSegment = segments[pluginsIndex + 1];
  if (!pluginSegment) {
    return { name: parseCatalogItemSlug(item) };
  }

  if (pluginsIndex > 0) {
    const ownerHandle = decodeURIComponent(segments[pluginsIndex - 1]);
    const pluginName = decodeURIComponent(pluginSegment);
    return {
      ownerHandle,
      name: packageNameFromPublisherPluginRoute(ownerHandle, pluginName) ?? pluginName,
    };
  }

  if (pluginSegment.startsWith("@") && segments[pluginsIndex + 2]) {
    const scope = decodeURIComponent(pluginSegment);
    const pluginName = decodeURIComponent(segments[pluginsIndex + 2]);
    return { name: `${scope}/${pluginName}` };
  }

  return { name: decodeURIComponent(pluginSegment) };
}

export function catalogItemToPublicSkill(item: PublicPublisherCatalogItem): PublicSkill {
  return {
    _id: item._id as Id<"skills">,
    _creationTime: item.updatedAt,
    slug: parseCatalogItemSlug(item),
    displayName: item.displayName,
    summary: item.summary ?? undefined,
    icon: item.icon ?? undefined,
    ownerUserId: "users:unknown" as Id<"users">,
    categories: item.categories,
    inferredCategories: item.inferredCategories,
    latestVersionId: item.latestVersionId as Id<"skillVersions"> | undefined,
    inferredFromVersionId: item.inferredFromVersionId as Id<"skillVersions"> | undefined,
    topics: item.topics,
    badges: item.isOfficial ? { official: { byUserId: "users:system" as Id<"users">, at: 0 } } : {},
    stats: {
      downloads: readPublicDownloadCount(item),
      stars: item.stars,
      versions: 0,
      comments: 0,
      installsCurrent: 0,
      installsAllTime: item.installs ?? 0,
    },
    isSuspicious: false,
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
    tags: {},
  };
}

function catalogItemToPackageListItem(item: PublicPublisherCatalogItem): PackageListItem {
  const route = parsePluginCatalogRoute(item);
  return {
    name: route.name,
    ownerHandle: route.ownerHandle,
    displayName: item.displayName,
    family: "code-plugin",
    channel: item.isOfficial ? "official" : "community",
    isOfficial: item.isOfficial,
    summary: item.summary,
    icon: item.icon,
    createdAt: item.updatedAt,
    updatedAt: item.updatedAt,
    categories: item.categories,
    topics: item.topics,
    stats: {
      downloads: readPublicDownloadCount(item),
      installs: item.installs ?? 0,
      stars: item.stars,
      versions: 0,
    },
  };
}

export function PublishedItemCard({ item }: { item: PublicPublisherCatalogItem }) {
  if (item.kind === "plugin") {
    const plugin = catalogItemToPackageListItem(item);
    return <PluginListItem item={plugin} variant="list" href={item.href} />;
  }

  const skill = catalogItemToPublicSkill(item);
  return <SkillListItem skill={skill} href={item.href} />;
}
