import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Bell, BellOff, CheckCheck, ChevronDown, ChevronUp, InboxIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { SignInPrompt } from "../components/SignInPrompt";
import { Button } from "../components/ui/button";
import { buildPublisherProfileHref } from "../lib/ownerRoute";
import { useAuthStatus } from "../lib/useAuthStatus";

const INBOX_PAGE_SIZE = 25;

type ActivityGroup = NonNullable<
  ReturnType<typeof useQuery<typeof api.publisherActivity.listMine>>
>["groups"][number];
type ActivityItem = ActivityGroup["previewItems"][number];
type NotificationPreference = "all" | "none";

export const Route = createFileRoute("/inbox")({
  component: FollowingInbox,
});

export function FollowingInbox() {
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const convex = useConvex();
  const firstPage = useQuery(
    api.publisherActivity.listMine,
    me ? { limit: INBOX_PAGE_SIZE, projection: "inbox" } : "skip",
  );
  const inboxState = useQuery(api.publisherActivityInbox.getMine, me ? {} : "skip");
  const followed = useQuery(
    api.publisherFollows.listFollowedPublishers,
    me ? { limit: 100 } : "skip",
  );
  const markSeenThrough = useMutation(api.publisherActivityInbox.markSeenThrough);
  const followPublisher = useMutation(api.publisherFollows.followPublisher);
  const [extraGroups, setExtraGroups] = useState<ActivityGroup[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);

  const allGroups = useMemo(() => {
    const byId = new Map<string, ActivityGroup>();
    for (const group of [...(firstPage?.groups ?? []), ...extraGroups]) {
      byId.set(group.groupId, group);
    }
    return [...byId.values()].sort((a, b) => b.activitySortKey.localeCompare(a.activitySortKey));
  }, [extraGroups, firstPage?.groups]);
  const notificationPreferences = useMemo(
    () =>
      new Map(
        (followed?.items ?? []).map((item) => [
          item.publisherId,
          item.notifications as NotificationPreference,
        ]),
      ),
    [followed?.items],
  );
  const groups = useMemo(
    () =>
      allGroups.filter(
        (group) => notificationPreferences.get(group.publisher.publisherId) === "all",
      ),
    [allGroups, notificationPreferences],
  );
  const mutedFollows = (followed?.items ?? []).filter((item) => item.notifications === "none");
  const effectiveNextCursor =
    nextCursor === undefined ? (firstPage?.nextCursor ?? null) : nextCursor;
  const unreadCount = groups.filter(
    (group) =>
      !inboxState?.seenThroughSortKey || group.activitySortKey > inboxState.seenThroughSortKey,
  ).length;

  if (isAuthLoading) return <InboxLoading />;
  if (!isAuthenticated || !me) {
    return (
      <SignInPrompt
        icon={InboxIcon}
        title="Sign in to see your inbox"
        description="Keep up with releases from publishers you follow."
      />
    );
  }
  if (!firstPage || !inboxState || !followed) return <InboxLoading />;

  const loadMore = async () => {
    if (!effectiveNextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await convex.query(api.publisherActivity.listMine, {
        cursor: effectiveNextCursor,
        limit: INBOX_PAGE_SIZE,
        projection: "inbox",
      });
      setExtraGroups((current) => [...current, ...page.groups]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      console.error("Failed to load more inbox activity:", error);
      toast.error("Unable to load more updates. Please try again.");
    } finally {
      setLoadingMore(false);
    }
  };

  const markAllRead = async () => {
    const newest = groups[0];
    if (!newest || unreadCount === 0 || markingRead) return;
    setMarkingRead(true);
    try {
      await markSeenThrough({ groupId: newest.groupId });
    } catch (error) {
      console.error("Failed to mark inbox read:", error);
      toast.error("Unable to mark updates as read. Please try again.");
    } finally {
      setMarkingRead(false);
    }
  };

  const unmutePublisher = async (publisherId: Id<"publishers">) => {
    try {
      await followPublisher({ publisherId, notifications: "all" });
      toast.success("Publisher unmuted");
    } catch (error) {
      console.error("Failed to unmute publisher:", error);
      toast.error("Unable to unmute this publisher. Please try again.");
    }
  };

  return (
    <main className="browse-page browse-page-narrow">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--oc-border-subtle)] pb-5">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--ink-soft)]">
            Your account
          </p>
          <h1 className="font-display text-3xl font-black leading-none text-[color:var(--ink)]">
            Inbox
          </h1>
          <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
            Coalesced releases from publishers you follow.
          </p>
        </div>
        {groups.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={unreadCount === 0 || markingRead}
            onClick={() => void markAllRead()}
          >
            <CheckCheck className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {unreadCount === 0 ? "All read" : `Mark ${unreadCount} read`}
          </Button>
        ) : null}
      </header>

      {groups.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="No updates yet"
          description="Follow a publisher to see their skill and plugin releases here."
          action={{ label: "Browse official publishers", href: "/official" }}
        />
      ) : (
        <div className="flex flex-col gap-3" aria-label="Following updates">
          {groups.map((group) => (
            <ActivityGroupCard
              key={group.groupId}
              group={group}
              unread={
                !inboxState.seenThroughSortKey ||
                group.activitySortKey > inboxState.seenThroughSortKey
              }
              notifications={notificationPreferences.get(group.publisher.publisherId) ?? "all"}
            />
          ))}
          {effectiveNextCursor ? (
            <Button
              type="button"
              variant="outline"
              className="self-center"
              disabled={loadingMore}
              onClick={() => void loadMore()}
            >
              {loadingMore ? "Loading…" : "Load older updates"}
            </Button>
          ) : null}
        </div>
      )}
      {mutedFollows.length > 0 ? (
        <section className="mt-8 border-t border-[color:var(--oc-border-subtle)] pt-5">
          <h2 className="text-sm font-bold text-[color:var(--ink)]">Muted publishers</h2>
          <p className="mb-3 text-xs text-[color:var(--ink-soft)]">
            Their releases still belong in your Following feed, but do not enter this inbox.
          </p>
          <div className="flex flex-wrap gap-2">
            {mutedFollows.map((follow) => (
              <Button
                key={follow.publisherId}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void unmutePublisher(follow.publisherId)}
              >
                <Bell className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Unmute @{follow.publisher.handle}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function ActivityGroupCard({
  group,
  unread,
  notifications,
}: {
  group: ActivityGroup;
  unread: boolean;
  notifications: NotificationPreference;
}) {
  const [expanded, setExpanded] = useState(false);
  const [updatingFollow, setUpdatingFollow] = useState(false);
  const expandedItems = useQuery(
    api.publisherActivity.listGroupItems,
    expanded ? { groupId: group.groupId, limit: 100 } : "skip",
  );
  const followPublisher = useMutation(api.publisherFollows.followPublisher);
  const unfollowPublisher = useMutation(api.publisherFollows.unfollowPublisher);
  const visibleItems = expanded ? (expandedItems?.items ?? []) : group.previewItems;
  const profileHref = buildPublisherProfileHref(group.publisher.handle);

  const updateNotifications = async () => {
    setUpdatingFollow(true);
    try {
      await followPublisher({
        publisherId: group.publisher.publisherId,
        notifications: notifications === "all" ? "none" : "all",
      });
      toast.success(notifications === "all" ? "Publisher muted" : "Publisher unmuted");
    } catch (error) {
      console.error("Failed to update publisher notifications:", error);
      toast.error("Unable to update this publisher. Please try again.");
    } finally {
      setUpdatingFollow(false);
    }
  };

  const unfollow = async () => {
    setUpdatingFollow(true);
    try {
      await unfollowPublisher({ publisherId: group.publisher.publisherId });
      toast.success(`Unfollowed @${group.publisher.handle}`);
    } catch (error) {
      console.error("Failed to unfollow publisher:", error);
      toast.error("Unable to unfollow this publisher. Please try again.");
    } finally {
      setUpdatingFollow(false);
    }
  };

  return (
    <article
      className={`rounded-[var(--oc-radius-surface)] border bg-[color:var(--oc-surface-card)] p-4 shadow-sm ${
        unread ? "border-[color:var(--oc-accent)]" : "border-[color:var(--oc-border-subtle)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-2 h-2 w-2 shrink-0 rounded-full ${
            unread ? "bg-[color:var(--oc-accent)]" : "bg-transparent"
          }`}
          aria-label={unread ? "Unread" : undefined}
        />
        {group.publisher.image ? (
          <img
            src={group.publisher.image}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--oc-bg-surface)] text-sm font-black text-[color:var(--ink)]">
            {group.publisher.displayName.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Link to={profileHref} className="font-bold text-[color:var(--ink)] hover:underline">
                {group.publisher.displayName}
              </Link>
              <p className="text-xs text-[color:var(--ink-soft)]">
                You follow @{group.publisher.handle} · {formatRelativeTime(group.eventAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={updatingFollow}
                onClick={() => void updateNotifications()}
              >
                {notifications === "all" ? (
                  <BellOff className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Bell className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                )}
                {notifications === "all" ? "Mute" : "Unmute"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={updatingFollow}
                onClick={() => void unfollow()}
              >
                Unfollow
              </Button>
            </div>
          </div>

          <p className="mt-3 text-sm font-semibold text-[color:var(--ink)]">
            Released {formatReleaseCount(group.recordedItemCount)}
          </p>
          <ul className="mt-2 divide-y divide-[color:var(--oc-border-subtle)]">
            {visibleItems.map((item) => (
              <ActivityItemRow key={item.activityId} item={item} />
            ))}
          </ul>
          {expanded && !expandedItems ? (
            <p className="mt-2 text-xs text-[color:var(--ink-soft)]">Loading releases…</p>
          ) : null}
          {expanded && expandedItems && !expandedItems.isDone ? (
            <p className="mt-2 text-xs text-[color:var(--ink-soft)]">
              Showing the first {expandedItems.items.length} releases in this batch.
            </p>
          ) : null}
          {group.hasMoreItems ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? (
                <ChevronUp className="mr-1 h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="mr-1 h-4 w-4" aria-hidden="true" />
              )}
              {expanded ? "Show preview" : `Show all ${group.recordedItemCount}`}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function ActivityItemRow({ item }: { item: ActivityItem }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <a
        href={item.artifact.href}
        className="font-semibold text-[color:var(--ink)] hover:underline"
      >
        {item.artifact.displayName}
      </a>
      <span className="font-mono text-xs text-[color:var(--ink-soft)]">v{item.version}</span>
    </li>
  );
}

export function formatReleaseCount(count: number) {
  return `${count} ${count === 1 ? "release" : "releases"}`;
}

function formatRelativeTime(timestamp: number) {
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(deltaSeconds) < 60) return formatter.format(deltaSeconds, "second");
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (Math.abs(deltaMinutes) < 60) return formatter.format(deltaMinutes, "minute");
  const deltaHours = Math.round(deltaMinutes / 60);
  if (Math.abs(deltaHours) < 24) return formatter.format(deltaHours, "hour");
  return formatter.format(Math.round(deltaHours / 24), "day");
}

function InboxLoading() {
  return (
    <main className="browse-page browse-page-narrow" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-[color:var(--oc-bg-surface)]" />
      <div className="mt-8 flex flex-col gap-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="h-36 animate-pulse rounded-[var(--oc-radius-surface)] bg-[color:var(--oc-bg-surface)]"
          />
        ))}
      </div>
    </main>
  );
}
