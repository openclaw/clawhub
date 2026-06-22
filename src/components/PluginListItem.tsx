import { Link } from "@tanstack/react-router";
import { PLUGIN_CATEGORY_DEFINITIONS } from "clawhub-schema";
import { Download } from "lucide-react";
import { formatCompactStat } from "../lib/numberFormat";
import type { PackageListItem } from "../lib/packageApi";
import { CatalogTopicList } from "./CatalogTopicList";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";

type PluginListItemProps = {
  item: PackageListItem;
  variant?: "list" | "card";
};

const PLUGIN_CATEGORY_LABELS = new Map<string, string>(
  PLUGIN_CATEGORY_DEFINITIONS.map(({ slug, label }) => [slug, label]),
);

function getPluginTaxonomyDisplay(item: PackageListItem) {
  const topics = (item.topics ?? []).filter((topic) => topic.trim());
  if (topics.length > 0) return { labels: topics, ariaLabel: "Topics" };

  const categories = (item.categories ?? []).flatMap((category) => {
    const label = PLUGIN_CATEGORY_LABELS.get(category);
    return label ? [label] : [];
  });
  return { labels: categories, ariaLabel: "Categories" };
}

export function PluginListItem({ item, variant = "list" }: PluginListItemProps) {
  const downloads = formatCompactStat(item.stats?.downloads ?? 0);
  const taxonomy = getPluginTaxonomyDisplay(item);

  if (variant === "card") {
    return (
      <Link
        to="/plugins/$name"
        params={{ name: item.name }}
        className="card skill-card plugin-card"
        aria-label={`Plugin: ${item.displayName}`}
      >
        {item.isOfficial ? (
          <div className="skill-card-tags">
            <OfficialBadge />
          </div>
        ) : null}
        <div className="skill-card-header">
          <MarketplaceIcon kind="plugin" label={item.displayName} imageUrl={item.icon} size="md" />
          <h3 className="skill-card-title">{item.displayName}</h3>
        </div>
        <p className="skill-card-summary">
          {item.summary ?? "Plugin package for agent workflows."}
        </p>
        <CatalogTopicList topics={taxonomy.labels} limit={3} ariaLabel={taxonomy.ariaLabel} />
        <div className="skill-card-footer">
          <div className="skill-list-item-meta plugin-card-meta">
            <span className="skill-list-item-meta-item">Plugin</span>
            {item.latestVersion ? (
              <span className="skill-list-item-meta-item">v{item.latestVersion}</span>
            ) : null}
            <span className="skill-list-item-meta-item">
              <Download size={14} aria-hidden="true" /> {downloads}
            </span>
            <span className="skill-list-item-meta-item">
              {item.ownerHandle ? `@${item.ownerHandle}` : "community"}
            </span>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to="/plugins/$name"
      params={{ name: item.name }}
      className="skill-list-item"
      aria-label={`Plugin: ${item.displayName}`}
    >
      <MarketplaceIcon kind="plugin" label={item.displayName} imageUrl={item.icon} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          {item.ownerHandle ? (
            <>
              <span className="skill-list-item-owner">@{item.ownerHandle}</span>
              <span className="skill-list-item-sep">/</span>
            </>
          ) : null}
          <span className="skill-list-item-name">{item.displayName}</span>
          {item.isOfficial ? <OfficialBadge /> : null}
        </div>
        <p className="skill-list-item-summary">
          {item.summary ?? "Plugin package for agent workflows."}
        </p>
        <CatalogTopicList topics={taxonomy.labels} ariaLabel={taxonomy.ariaLabel} />
        <div className="skill-list-item-meta">
          <span className="skill-list-item-meta-item">Plugin</span>
          {item.latestVersion ? (
            <span className="skill-list-item-meta-item">v{item.latestVersion}</span>
          ) : null}
          <span className="skill-list-item-meta-item">
            <Download size={14} aria-hidden="true" /> {downloads}
          </span>
          <span className="skill-list-item-meta-item">
            {item.ownerHandle ? `@${item.ownerHandle}` : "community"}
          </span>
        </div>
      </div>
    </Link>
  );
}
