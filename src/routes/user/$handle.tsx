import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { normalizeCatalogTopic } from "clawhub-schema";
import { usePaginatedQuery, useQuery } from "convex/react";
import { Building2, Download, Package, Star, Users, Wrench, type LucideIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { MarketplaceIcon } from "../../components/MarketplaceIcon";
import { OfficialBadge, OfficialTag } from "../../components/OfficialBadge";
import { BrowseResultsSkeleton } from "../../components/skeletons/BrowseResultsSkeleton";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { formatCompactStat } from "../../lib/numberFormat";
import { buildPublisherMeta } from "../../lib/og";
import type {
  PublicPublisher,
  PublicPublisherCatalogDisplay,
  PublicPublisherCatalogItem,
  PublicPublisherListItem,
} from "../../lib/publicUser";
import { readPublicDownloadCount } from "../../lib/publicUser";

export const Route = createFileRoute("/user/$handle")({
  loader: async ({ params }) => {
    const { convexHttp } = await import("../../convex/client");
    const publisher = (await convexHttp.query(api.publishers.getProfileByHandle, {
      handle: params.handle,
    })) as PublicPublisherListItem | null;
    if (!publisher) throw notFound();
    return { publisher };
  },
  head: ({ params }) => {
    const meta = buildPublisherMeta({ handle: params.handle });
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

type PublishedView = "list" | "grid";
type ProfileCatalogTab = "skills" | "plugins" | "stars";

const roleColor: Record<string, "accent" | "default" | "compact"> = {
  owner: "accent",
  admin: "default",
  publisher: "compact",
};

function GitHubIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function PublisherProfile() {
  const { handle } = Route.useParams();
  const { publisher: loaderPublisher } = Route.useLoaderData() as {
    publisher: PublicPublisherListItem;
  };
  const [catalogTab, setCatalogTab] = useState<ProfileCatalogTab>("skills");
  const publishedKind: "skill" | "plugin" = catalogTab === "plugins" ? "plugin" : "skill";
  const queriedPublisher = useQuery(api.publishers.getProfileByHandle, { handle }) as
    | PublicPublisherListItem
    | null
    | undefined;
  const publisher = queriedPublisher === undefined ? loaderPublisher : queriedPublisher;
  // The backend normalizes this legacy validator-compatible alias to install ranking.
  const publishedQueryArgs: {
    handle: string;
    kind: "skill" | "plugin";
    sort: "downloads";
  } = { handle, kind: publishedKind, sort: "downloads" };
  const publishedDisplay = useQuery(
    api.publishers.getPublishedDisplayManifest,
    publishedQueryArgs,
  ) as PublicPublisherCatalogDisplay | null | undefined;
  const members = useQuery(api.publishers.listMembers, { publisherHandle: handle }) as
    | PublisherMemberResult
    | null
    | undefined;
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
    { handle, sort: "downloads" },
    {
      initialNumItems: 12,
    },
  );
  const publishedItems = (publishedResults ?? []) as PublicPublisherCatalogItem[];
  const starredItems = (starredResults ?? []) as PublicPublisherCatalogItem[];

  if (publisher === undefined) {
    return (
      <main className="py-10">
        <Container>
          <div className="publisher-profile-page">
            <Card className="publisher-profile-hero">
              <CardContent className="publisher-profile-hero-inner">
                <Skeleton className="h-20 w-20 rounded-[var(--r-md)]" />
                <div className="publisher-profile-heading">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-7 w-56" />
                  <Skeleton className="h-4 w-80 max-w-full" />
                </div>
              </CardContent>
            </Card>
            <BrowseResultsSkeleton count={6} variant="list" />
          </div>
        </Container>
      </main>
    );
  }

  if (!publisher) {
    return (
      <main className="py-10">
        <Container>
          <EmptyState
            icon={Building2}
            title="Publisher not found"
            description="This publisher doesn't exist or may have been removed."
            action={{ label: "Browse publishers", href: "/publishers" }}
          />
        </Container>
      </main>
    );
  }

  const publishedCount = publisher.stats.skills + publisher.stats.packages;
  const affiliations = publisher.affiliations ?? [];
  const visibleAffiliations = affiliations.slice(0, 1);
  const memberCount = members?.members.length ?? 0;
  const activeCatalogTab = catalogTab;
  const activeItems = activeCatalogTab === "stars" ? starredItems : publishedItems;
  const topicGroups = useMemo(
    () => (activeCatalogTab === "stars" ? [] : groupPublisherCatalogItemsByTopic(activeItems)),
    [activeCatalogTab, activeItems],
  );
  const activeStatus = activeCatalogTab === "stars" ? starredStatus : publishedStatus;
  const activeLoadMore = activeCatalogTab === "stars" ? loadMoreStarred : loadMore;
  const activePublishedDisplay = activeCatalogTab === "skills" ? publishedDisplay : null;
  const isLoadingCatalog = activeStatus === "LoadingFirstPage";

  return (
    <main className="publisher-profile-route">
      <Container>
        <div className="publisher-profile-page">
          <section className="publisher-profile-hero">
            <div className="publisher-profile-hero-main">
              <div className="publisher-profile-avatar">
                <MarketplaceIcon
                  kind={publisher.kind === "org" ? "org" : "user"}
                  label={publisher.displayName}
                  imageUrl={publisher.image}
                  size="md"
                />
              </div>
              <div className="publisher-profile-heading">
                <span className="publisher-profile-handle">@{publisher.handle}</span>
                <div className="publisher-profile-title-row">
                  <h1>{publisher.displayName}</h1>
                  {publisher.official ? <OfficialTag /> : null}
                  {publisher.kind === "user"
                    ? visibleAffiliations.map((entry) => (
                        <Link
                          key={entry.publisher._id}
                          to="/user/$handle"
                          params={{ handle: entry.publisher.handle }}
                          className="publisher-profile-affiliation-badge"
                        >
                          <MarketplaceIcon
                            kind="org"
                            label={entry.publisher.displayName}
                            imageUrl={entry.publisher.image}
                            size="xs"
                          />
                          {entry.publisher.displayName}
                        </Link>
                      ))
                    : null}
                  {publisher.kind === "user" && affiliations.length > visibleAffiliations.length ? (
                    <span className="publisher-profile-affiliation-more">
                      +{affiliations.length - visibleAffiliations.length}
                    </span>
                  ) : null}
                </div>
                {publisher.bio ? <p>{publisher.bio}</p> : null}
              </div>
            </div>
            <div className="publisher-profile-hero-stats" aria-label="Publisher stats">
              <PublisherStat
                icon={Download}
                value={formatCompactStat(publisher.stats.downloads)}
                label="downloads"
              />
              <PublisherStat
                icon={Star}
                value={formatCompactStat(publisher.stats.stars)}
                label="stars"
              />
              <PublisherStat
                icon={Package}
                value={formatCompactStat(publishedCount)}
                label="published"
              />
              {publisher.kind === "org" ? (
                <PublisherStat
                  icon={Users}
                  value={formatCompactStat(memberCount)}
                  label={memberCount === 1 ? "member" : "members"}
                />
              ) : null}
            </div>
          </section>

          <div className="publisher-profile-layout">
            <aside className="publisher-profile-sidebar">
              {publisher.kind !== "org" ? (
                <section className="publisher-profile-panel">
                  <h2>Details</h2>
                  <div className="publisher-profile-detail-list">
                    <ProfileDetail
                      icon={GitHubIcon}
                      label="GitHub"
                      value={`@${publisher.handle}`}
                      href={`https://github.com/${publisher.handle}`}
                    />
                  </div>
                </section>
              ) : null}

              {publisher.kind === "user" && affiliations.length > 0 ? (
                <section className="publisher-profile-panel">
                  <div className="publisher-profile-panel-heading">
                    <h2>Orgs</h2>
                    <span>{formatCompactStat(affiliations.length)}</span>
                  </div>
                  <div className="publisher-profile-orgs" aria-label="Organizations">
                    {affiliations.map((entry) => (
                      <Link
                        key={entry.publisher._id}
                        to="/user/$handle"
                        params={{ handle: entry.publisher.handle }}
                        className="publisher-profile-org"
                      >
                        <MarketplaceIcon
                          kind="org"
                          label={entry.publisher.displayName}
                          imageUrl={entry.publisher.image}
                          size="sm"
                        />
                        <span className="publisher-profile-org-copy">
                          <strong className="publisher-profile-org-name">
                            <span className="publisher-profile-org-name-text">
                              {entry.publisher.displayName}
                            </span>
                            {entry.publisher.official ? <OfficialBadge /> : null}
                          </strong>
                          <small>@{entry.publisher.handle}</small>
                        </span>
                        <span className="publisher-profile-org-role">{entry.role}</span>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}

              {publisher.kind === "org" ? (
                <section className="publisher-profile-panel">
                  <h2>Members</h2>
                  {(members?.members ?? []).length > 0 ? (
                    <div className="publisher-profile-members">
                      {members?.members.map((entry) => (
                        <Link
                          key={`${entry.user._id}:${entry.role}`}
                          to="/user/$handle"
                          params={{ handle: entry.user.handle ?? publisher.handle }}
                          className="publisher-profile-member"
                        >
                          <MarketplaceIcon
                            kind="user"
                            label={entry.user.displayName ?? entry.user.handle ?? "User"}
                            imageUrl={entry.user.image}
                            size="sm"
                          />
                          <span className="publisher-profile-member-copy">
                            <strong className="publisher-profile-member-name">
                              <span className="publisher-profile-member-name-text">
                                {entry.user.displayName ?? entry.user.handle ?? "User"}
                              </span>
                              {entry.user.official ? <OfficialBadge /> : null}
                            </strong>
                            {entry.user.handle ? <small>@{entry.user.handle}</small> : null}
                          </span>
                          <span
                            className={`publisher-profile-member-role publisher-profile-member-role-${roleColor[entry.role] ?? "default"}`}
                          >
                            {entry.role}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="publisher-profile-empty-copy">No members listed.</p>
                  )}
                </section>
              ) : null}
            </aside>

            <section className="publisher-profile-main" aria-labelledby="publisher-published-title">
              <div className="publisher-profile-section-header">
                <div>
                  <h2 id="publisher-published-title" className="sr-only">
                    Publisher catalog
                  </h2>
                  <div className="publisher-profile-catalog-tabs" aria-label="Catalog">
                    <button
                      type="button"
                      className={activeCatalogTab === "skills" ? "is-active" : undefined}
                      onClick={() => setCatalogTab("skills")}
                    >
                      <Wrench size={14} aria-hidden="true" />
                      Skills <span>{formatCompactStat(publisher.stats.skills)}</span>
                    </button>
                    <button
                      type="button"
                      className={activeCatalogTab === "plugins" ? "is-active" : undefined}
                      onClick={() => setCatalogTab("plugins")}
                    >
                      <Package size={14} aria-hidden="true" />
                      Plugins <span>{formatCompactStat(publisher.stats.packages)}</span>
                    </button>
                    {publisher.kind === "user" ? (
                      <button
                        type="button"
                        className={activeCatalogTab === "stars" ? "is-active" : undefined}
                        onClick={() => setCatalogTab("stars")}
                      >
                        <Star size={14} aria-hidden="true" />
                        Stars <span>{formatCompactStat(publisher.starredCount ?? 0)}</span>
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {isLoadingCatalog ? (
                <BrowseResultsSkeleton count={6} variant="list" />
              ) : activePublishedDisplay ? (
                <PublishedCatalogSections display={activePublishedDisplay} view="list" />
              ) : topicGroups.length > 1 ? (
                <TopicGroupedCatalogSections groups={topicGroups} view="list" />
              ) : activeItems.length > 0 ? (
                <>
                  <div className="results-list">
                    {activeItems.map((item) => (
                      <PublishedItemCard key={`${item.kind}:${item._id}`} item={item} view="list" />
                    ))}
                  </div>
                  {activeStatus === "CanLoadMore" ? (
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
                  title={
                    activeCatalogTab === "stars"
                      ? "No starred items yet"
                      : activeCatalogTab === "plugins"
                        ? "No published plugins yet"
                        : "No published skills yet"
                  }
                />
              )}
            </section>
          </div>
        </div>
      </Container>
    </main>
  );
}

export function groupPublisherCatalogItemsByTopic(items: PublicPublisherCatalogItem[]) {
  const groups = new Map<string, { title: string; items: PublicPublisherCatalogItem[] }>();
  for (const item of items) {
    const rawTopic = item.topics?.[0]?.trim();
    const title = rawTopic || "Other";
    const key = rawTopic
      ? (normalizeCatalogTopic(rawTopic) ?? rawTopic.toLocaleLowerCase("en-US"))
      : "other";
    const group = groups.get(key) ?? { title, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, value]) => ({ key, ...value }));
}

function TopicGroupedCatalogSections({
  groups,
  view,
}: {
  groups: ReturnType<typeof groupPublisherCatalogItemsByTopic>;
  view: PublishedView;
}) {
  return (
    <div className="publisher-profile-source-catalog">
      {groups.map((group) => (
        <section key={group.key} className="publisher-profile-manifest-section">
          <div className="publisher-profile-manifest-heading">
            <h3>{group.title}</h3>
          </div>
          <div className={view === "list" ? "results-list" : "grid publisher-published-grid"}>
            {group.items.map((item) => (
              <PublishedItemCard key={`${item.kind}:${item._id}`} item={item} view={view} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PublisherStat({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <span className="publisher-profile-stat">
      <Icon size={16} aria-hidden="true" />
      <strong>{value}</strong>
      {label}
    </span>
  );
}

function ProfileDetail({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: (props: { size?: number; "aria-hidden"?: boolean }) => ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const content = (
    <>
      <span>
        <Icon size={14} aria-hidden={true} />
        {label}
      </span>
      <strong>{value}</strong>
    </>
  );

  return href ? (
    <a className="publisher-profile-detail" href={href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <div className="publisher-profile-detail">{content}</div>
  );
}

// Exported for unit testing. The publisher profile route is the only
// production consumer; tests assert that custom skill icons forwarded via
// `item.icon` reach `MarketplaceIcon`.
export function PublishedCatalogSections({
  display,
  view,
}: {
  display: PublicPublisherCatalogDisplay;
  view: PublishedView;
}) {
  return (
    <div className="publisher-profile-source-catalog">
      {display.sections.map((section) => (
        <section key={section.key} className="publisher-profile-manifest-section">
          <div className="publisher-profile-manifest-heading">
            <div>
              <h3>{section.title}</h3>
              {section.description ? <p>{section.description}</p> : null}
            </div>
          </div>
          <div className={view === "list" ? "results-list" : "grid publisher-published-grid"}>
            {section.items.map((item) => (
              <PublishedItemCard key={`${item.kind}:${item._id}`} item={item} view={view} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function PublishedItemCard({
  item,
  view,
}: {
  item: PublicPublisherCatalogItem;
  view: PublishedView;
}) {
  if (view === "grid") {
    return (
      <Link to={item.href} className="card skill-card">
        <div className="skill-card-header">
          <MarketplaceIcon
            kind={item.kind}
            label={item.displayName}
            imageUrl={item.kind === "plugin" ? item.icon : null}
            icon={item.kind === "skill" ? item.icon : null}
            skill={item.kind === "skill" ? item : null}
            size="md"
          />
          <h3 className="skill-card-title">{item.displayName}</h3>
          {item.isOfficial ? <OfficialBadge /> : null}
        </div>
        <p className="skill-card-summary">
          {item.summary ?? `${item.kind === "plugin" ? "Plugin" : "Skill"} published on ClawHub.`}
        </p>
        <div className="skill-card-footer">
          <div className="skill-card-footer-inline publisher-published-card-stats">
            <span className="skill-list-item-meta-item">
              <Download size={14} aria-hidden="true" />
              <strong>{formatCompactStat(readPublicDownloadCount(item))}</strong> downloads
            </span>
            <span className="skill-list-item-meta-item">
              <Star size={14} aria-hidden="true" />
              {formatCompactStat(item.stars)}
            </span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link to={item.href} className="skill-list-item publisher-published-row">
      <MarketplaceIcon
        kind={item.kind}
        label={item.displayName}
        imageUrl={item.kind === "plugin" ? item.icon : null}
        icon={item.kind === "skill" ? item.icon : null}
        skill={item.kind === "skill" ? item : null}
      />
      <div className="skill-list-item-body">
        <span className="skill-list-item-main">
          <span className="skill-list-item-name">{item.displayName}</span>
          {item.isOfficial ? <OfficialBadge /> : null}
        </span>
        {item.summary ? <p className="skill-list-item-summary">{item.summary}</p> : null}
      </div>
      <div className="skill-list-item-meta publisher-published-row-stats">
        <span className="skill-list-item-meta-item">
          <Download size={14} aria-hidden="true" />
          <strong>{formatCompactStat(readPublicDownloadCount(item))}</strong> downloads
        </span>
        <span className="skill-list-item-meta-item">
          <Star size={14} aria-hidden="true" />
          {formatCompactStat(item.stars)}
        </span>
      </div>
    </Link>
  );
}
