import { Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { formatCompactStat } from "../lib/numberFormat";
import {
  type PublicPublisherListItem,
  type PublicPublisherPublishedItem,
  readPublicDownloadCount,
} from "../lib/publicUser";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";

type PublisherListItemProps = {
  publisher: PublicPublisherListItem;
  variant?: "list" | "grid" | "highlight";
};

function PublishedRail({ items }: { items: PublicPublisherPublishedItem[] }) {
  if (items.length === 0) return null;
  return (
    <span className="publisher-published-rail" aria-label="Published packages">
      {items.slice(0, 3).map((item) => (
        <span className="publisher-published-rail-item" key={`${item.kind}:${item.displayName}`}>
          <MarketplaceIcon kind={item.kind} label={item.displayName} size="xs" />
        </span>
      ))}
    </span>
  );
}

export function PublisherListItem({ publisher, variant = "list" }: PublisherListItemProps) {
  const handle = publisher.handle.trim();
  if (!handle) return null;

  const publishedCount = publisher.stats.packages + publisher.stats.skills;
  const summary =
    publisher.bio?.trim() ||
    (publisher.kind === "org" ? "Org publisher on ClawHub." : "Publisher on ClawHub.");
  const summaryInMain = variant !== "grid";
  const featuredItems = publisher.publishedItems.slice(0, 3);

  return (
    <Link
      to="/user/$handle"
      params={{ handle }}
      className={`publisher-card publisher-card-${variant}`}
      aria-label={`Publisher: ${publisher.displayName}`}
    >
      <div className="publisher-card-main">
        <MarketplaceIcon
          kind={publisher.kind === "org" ? "org" : "user"}
          label={publisher.displayName}
          imageUrl={publisher.image}
          size={variant === "list" ? "sm" : "md"}
        />
        <div className="publisher-card-copy">
          <span className="publisher-card-title-row">
            <span className="publisher-card-name">{publisher.displayName}</span>
            {publisher.official ? <OfficialBadge /> : null}
            {variant === "list" ? <span className="publisher-card-handle">@{handle}</span> : null}
            {publisher.kind === "org" ? <span className="publisher-card-kind">Org</span> : null}
          </span>
          {variant === "list" ? null : <span className="publisher-card-handle">@{handle}</span>}
          {summaryInMain ? <p className="publisher-card-summary">{summary}</p> : null}
          {variant === "highlight" && publisher.publishedItems.length > 0 ? (
            <div className="publisher-card-featured-items">
              {featuredItems.map((item) => (
                <span key={`${item.kind}:${item.displayName}`}>
                  <MarketplaceIcon kind={item.kind} label={item.displayName} size="xs" />
                  <span className="publisher-card-featured-label">{item.displayName}</span>
                  <span className="publisher-card-featured-downloads">
                    <Download size={12} aria-hidden="true" />
                    <span>{formatCompactStat(readPublicDownloadCount(item))}</span>
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {summaryInMain ? null : <p className="publisher-card-summary">{summary}</p>}
      <div className="publisher-card-stats">
        <span className="publisher-card-stat">
          <PublishedRail items={publisher.publishedItems} />
          <strong>{formatCompactStat(publishedCount)}</strong>
          published
        </span>
        <span className="publisher-card-stat is-primary">
          <Download size={14} aria-hidden="true" />
          <strong>{formatCompactStat(publisher.stats.downloads)}</strong>
          downloads
        </span>
      </div>
    </Link>
  );
}
