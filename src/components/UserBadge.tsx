import { Package, Star, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexHttp } from "../convex/client";
import { hasOwnProperty } from "../lib/hasOwnProperty";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicPublisher, PublicUser } from "../lib/publicUser";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type UserBadgeProps = {
  user: PublicUser | PublicPublisher | null | undefined;
  fallbackHandle?: string | null;
  prefix?: string;
  size?: "sm" | "md";
  link?: boolean;
  showName?: boolean;
};

export function UserBadge({
  user,
  fallbackHandle,
  prefix = "by",
  size = "sm",
  link = true,
  showName = false,
}: UserBadgeProps) {
  const userName = hasOwnProperty(user, "name") && typeof user.name === "string"
    ? user.name.trim()
    : undefined;
  const displayName = user?.displayName?.trim() || userName || null;
  const handle = user?.handle ?? fallbackHandle ?? null;
  const href =
    user?.handle && hasOwnProperty(user, "kind")
      ? user.kind === "org"
        ? `/orgs/${encodeURIComponent(user.handle)}`
        : `/u/${encodeURIComponent(user.handle)}`
      : user?.handle
        ? `/u/${encodeURIComponent(user.handle)}`
        : null;
  const label = handle ? `@${handle}` : "user";
  const image = user?.image ?? null;
  const hasUsefulName =
    showName &&
    Boolean(displayName) &&
    Boolean(handle) &&
    displayName!.toLowerCase() !== handle!.toLowerCase();
  const initial = (displayName ?? handle ?? "u").charAt(0).toUpperCase();

  // Resolve userId for stats query — PublicUser has _id directly,
  // PublicPublisher has linkedUserId
  const userId =
    user && hasOwnProperty(user, "kind")
      ? (user as PublicPublisher).linkedUserId ?? null
      : user?._id ?? null;

  const badge = (
    <span className={`user-badge user-badge-${size}`}>
      {prefix ? <span className="user-badge-prefix">{prefix}</span> : null}
      <span className="user-avatar" aria-hidden="true">
        {image ? (
          <img className="user-avatar-img" src={image} alt="" loading="lazy" />
        ) : (
          <span className="user-avatar-fallback">{initial}</span>
        )}
      </span>
      {hasUsefulName ? (
        <>
          <span className="user-name">{displayName}</span>
          <span className="user-name-sep" aria-hidden="true">
            ·
          </span>
        </>
      ) : null}
      {link && href ? (
        <a className="user-handle" href={href}>
          {label}
        </a>
      ) : (
        <span className="user-handle">{label}</span>
      )}
    </span>
  );

  if (!userId) return badge;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <UserStatsTooltipContent userId={userId} displayName={displayName} handle={handle} />
    </Tooltip>
  );
}

type HoverStats = { publishedSkills: number; totalStars: number; totalDownloads: number };

function UserStatsTooltipContent({
  userId,
  displayName,
  handle,
}: {
  userId: string;
  displayName: string | null;
  handle: string | null;
}) {
  const [stats, setStats] = useState<HoverStats | null>(null);
  const [fetched, setFetched] = useState(false);

  // One-shot fetch on mount (tooltip content only mounts when open)
  useEffect(() => {
    if (fetched) return;
    setFetched(true);
    void convexHttp
      .query(api.users.getHoverStats, { userId: userId as Id<"users"> })
      .then(setStats)
      .catch(() => {});
  }, [userId, fetched]);

  return (
    <TooltipContent
      side="top"
      className="min-w-[140px] p-0"
      onPointerDownOutside={(e) => e.preventDefault()}
    >
      <div className="flex flex-col gap-space-1 px-3 py-2">
        {displayName && (
          <span className="text-fs-sm font-semibold text-ink truncate max-w-[180px]">
            {displayName}
          </span>
        )}
        {handle && (
          <span className="text-fs-xs text-ink-soft">@{handle}</span>
        )}
      </div>
      <div className="border-t border-line flex items-center gap-space-3 px-3 py-2">
        {stats === null ? (
          <span className="text-fs-xs text-ink-soft">Loading...</span>
        ) : (
          <>
            <span className="flex items-center gap-1 text-fs-xs text-ink-soft" title="Published skills">
              <Package size={12} />
              {formatCompactStat(stats.publishedSkills)}
            </span>
            <span className="flex items-center gap-1 text-fs-xs text-ink-soft" title="Stars received">
              <Star size={12} />
              {formatCompactStat(stats.totalStars)}
            </span>
            <span className="flex items-center gap-1 text-fs-xs text-ink-soft" title="Total downloads">
              <Download size={12} />
              {formatCompactStat(stats.totalDownloads)}
            </span>
          </>
        )}
      </div>
    </TooltipContent>
  );
}
