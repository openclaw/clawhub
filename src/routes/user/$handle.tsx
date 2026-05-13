import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  ArrowDownToLine,
  Building2,
  LayoutGrid,
  List,
  Package,
  Star,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { MarketplaceIcon } from "../../components/MarketplaceIcon";
import { SkillCardSkeletonGrid } from "../../components/skeletons/SkillCardSkeleton";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { formatCompactStat } from "../../lib/numberFormat";
import type {
  PublicPublisher,
  PublicPublisherCatalogItem,
  PublicPublisherListItem,
} from "../../lib/publicUser";

export const Route = createFileRoute("/user/$handle")({
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
    };
  }>;
};

type PublishedView = "list" | "grid";
type PublishedKindFilter = "skill" | "plugin" | undefined;
type ProfileCatalogTab = "published" | "starred";
type PublishedSort = "downloads" | "recent";

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
  const [publishedView, setPublishedView] = useState<PublishedView>("list");
  const [catalogTab, setCatalogTab] = useState<ProfileCatalogTab>("published");
  const [publishedKind, setPublishedKind] = useState<PublishedKindFilter>(undefined);
  const [publishedSort, setPublishedSort] = useState<PublishedSort>("downloads");
  const publishedQueryArgs = publishedKind
    ? { handle, kind: publishedKind, sort: publishedSort }
    : { handle, sort: publishedSort };
  const publisher = useQuery(api.publishers.getProfileByHandle, { handle }) as
    | PublicPublisherListItem
    | null
    | undefined;
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
    { handle, sort: publishedSort },
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
            <SkillCardSkeletonGrid count={6} />
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
  const activeCatalogTab = publisher.kind === "user" ? catalogTab : "published";
  const activeItems = activeCatalogTab === "starred" ? starredItems : publishedItems;
  const activeStatus = activeCatalogTab === "starred" ? starredStatus : publishedStatus;
  const activeLoadMore = activeCatalogTab === "starred" ? loadMoreStarred : loadMore;
  const isLoadingCatalog = activeStatus === "LoadingFirstPage";
  const showPublishedKindFilters = activeCatalogTab === "published" && publishedCount > 0;

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
                  {publisher.kind === "org" ? <Badge variant="compact">Org</Badge> : null}
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
                icon={ArrowDownToLine}
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
              <section className="publisher-profile-panel">
                <h2>Details</h2>
                <div className="publisher-profile-detail-list">
                  <ProfileDetail
                    icon={Wrench}
                    label="Skills"
                    value={formatCompactStat(publisher.stats.skills)}
                  />
                  <ProfileDetail
                    icon={Package}
                    label="Plugins"
                    value={formatCompactStat(publisher.stats.packages)}
                  />
                  {publisher.kind !== "org" && (
                    <ProfileDetail
                      icon={GitHubIcon}
                      label="GitHub"
                      value={`@${publisher.handle}`}
                      href={`https://github.com/${publisher.handle}`}
                    />
                  )}
                </div>
              </section>

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
                          <strong>{entry.publisher.displayName}</strong>
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
                          <span>
                            <strong>{entry.user.displayName ?? entry.user.handle ?? "User"}</strong>
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
                  {publisher.kind === "user" ? (
                    <div className="publisher-profile-collection-tabs" aria-label="Catalog">
                      <button
                        type="button"
                        className={activeCatalogTab === "published" ? "is-active" : undefined}
                        onClick={() => setCatalogTab("published")}
                      >
                        Published <span>{formatCompactStat(publishedCount)}</span>
                      </button>
                      <button
                        type="button"
                        className={activeCatalogTab === "starred" ? "is-active" : undefined}
                        onClick={() => setCatalogTab("starred")}
                      >
                        Starred <span>{formatCompactStat(publisher.starredCount ?? 0)}</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <h2>Published</h2>
                      <span>{formatCompactStat(publishedCount)} items</span>
                    </>
                  )}
                </div>
                <div className="publisher-profile-section-controls">
                  <div className="publisher-profile-sort-tabs" aria-label="Sort catalog">
                    <button
                      type="button"
                      className={publishedSort === "downloads" ? "is-active" : undefined}
                      onClick={() => setPublishedSort("downloads")}
                    >
                      Downloads
                    </button>
                    <button
                      type="button"
                      className={publishedSort === "recent" ? "is-active" : undefined}
                      onClick={() => setPublishedSort("recent")}
                    >
                      Recent
                    </button>
                  </div>
                  {showPublishedKindFilters ? (
                    <div className="publisher-profile-kind-tabs" aria-label="Published type">
                      <button
                        type="button"
                        className={!publishedKind ? "is-active" : undefined}
                        onClick={() => setPublishedKind(undefined)}
                      >
                        All {formatCompactStat(publishedCount)}
                      </button>
                      <button
                        type="button"
                        className={publishedKind === "skill" ? "is-active" : undefined}
                        onClick={() => setPublishedKind("skill")}
                      >
                        Skills {formatCompactStat(publisher.stats.skills)}
                      </button>
                      <button
                        type="button"
                        className={publishedKind === "plugin" ? "is-active" : undefined}
                        onClick={() => setPublishedKind("plugin")}
                      >
                        Plugins {formatCompactStat(publisher.stats.packages)}
                      </button>
                    </div>
                  ) : null}
                  <div className="publisher-profile-view-tabs" aria-label="Published view">
                    <button
                      type="button"
                      className={publishedView === "list" ? "is-active" : undefined}
                      onClick={() => setPublishedView("list")}
                      aria-label="List view"
                    >
                      <List size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={publishedView === "grid" ? "is-active" : undefined}
                      onClick={() => setPublishedView("grid")}
                      aria-label="Grid view"
                    >
                      <LayoutGrid size={15} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              {isLoadingCatalog ? (
                <SkillCardSkeletonGrid count={6} />
              ) : activeItems.length > 0 ? (
                <>
                  <div
                    className={
                      publishedView === "list" ? "results-list" : "grid publisher-published-grid"
                    }
                  >
                    {activeItems.map((item) => (
                      <PublishedItemCard
                        key={`${item.kind}:${item._id}`}
                        item={item}
                        view={publishedView}
                      />
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
                    activeCatalogTab === "starred"
                      ? "No starred items yet"
                      : "No published items yet"
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
            icon={item.kind === "skill" ? item.icon : null}
            size="md"
          />
          <h3 className="skill-card-title">{item.displayName}</h3>
        </div>
        <p className="skill-card-summary">
          {item.summary ?? `${item.kind === "plugin" ? "Plugin" : "Skill"} published on ClawHub.`}
        </p>
        <div className="skill-card-footer">
          <div className="skill-card-footer-inline publisher-published-card-stats">
            <span className="skill-list-item-meta-item">
              <ArrowDownToLine size={14} aria-hidden="true" />
              <strong>{formatCompactStat(item.downloads)}</strong> downloads
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
        icon={item.kind === "skill" ? item.icon : null}
      />
      <div className="skill-list-item-body">
        <span className="skill-list-item-main">
          <span className="skill-list-item-owner">@{item.kind}</span>
          <span className="skill-list-item-sep">/</span>
          <span className="skill-list-item-name">{item.displayName}</span>
        </span>
        {item.summary ? <p className="skill-list-item-summary">{item.summary}</p> : null}
      </div>
      <div className="skill-list-item-meta publisher-published-row-stats">
        <span className="skill-list-item-meta-item">
          <ArrowDownToLine size={14} aria-hidden="true" />
          <strong>{formatCompactStat(item.downloads)}</strong> downloads
        </span>
        <span className="skill-list-item-meta-item">
          <Star size={14} aria-hidden="true" />
          {formatCompactStat(item.stars)}
        </span>
      </div>
    </Link>
  );
}
