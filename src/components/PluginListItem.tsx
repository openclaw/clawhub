import { Link } from "@tanstack/react-router";
import { isPluginCategorySlug, PLUGIN_CATEGORY_DEFINITIONS } from "clawhub-schema";
import { Download } from "lucide-react";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import { formatCompactStat } from "../lib/numberFormat";
import type { PackageListItem } from "../lib/packageApi";
import { buildPluginDetailHref } from "../lib/pluginRoutes";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "../lib/truncateText";
import { CatalogTopicList } from "./CatalogTopicList";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";

type PluginListItemProps = {
  item: PackageListItem;
  variant?: "list" | "card";
  href?: string;
};

const PLUGIN_CATEGORIES_BY_SLUG = new Map(
  PLUGIN_CATEGORY_DEFINITIONS.map((category) => [category.slug, category]),
);

function getPluginTaxonomyDisplay(item: PackageListItem) {
  const topics = (item.topics ?? []).filter((topic) => topic.trim());
  if (topics.length > 0) return { labels: topics, ariaLabel: "Topics" };

  const categories = (item.categories ?? []).flatMap((category) => {
    return isPluginCategorySlug(category) && PLUGIN_CATEGORIES_BY_SLUG.has(category)
      ? [category]
      : [];
  });
  return { labels: categories, ariaLabel: "Categories" };
}

function getPluginCategories(item: PackageListItem) {
  return (item.categories ?? []).flatMap((slug) => {
    if (!isPluginCategorySlug(slug)) return [];
    const category = PLUGIN_CATEGORIES_BY_SLUG.get(slug);
    return category ? [category] : [];
  });
}

export function PluginListItem({ item, variant = "list", href }: PluginListItemProps) {
  const downloads = formatCompactStat(item.stats?.downloads ?? 0);
  const taxonomy = getPluginTaxonomyDisplay(item);
  const categories = getPluginCategories(item);
  const primaryCategory = categories[0] ?? null;
  const categoryLabel = categories
    .slice(0, 3)
    .map((category) => category.label)
    .join(", ");
  const pluginHref = href ?? buildPluginDetailHref(item.name, { ownerHandle: item.ownerHandle });

  if (variant === "card") {
    return (
      <Link
        to={pluginHref}
        className="card skill-card plugin-card"
        aria-label={`Plugin: ${item.displayName}`}
      >
        <div className="skill-card-header">
          <MarketplaceIcon kind="plugin" label={item.displayName} imageUrl={item.icon} size="md" />
          <div className="skill-card-identity">
            <h3 className="skill-card-title" title={item.displayName}>
              {truncateText(item.displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
            </h3>
            <span className="skill-card-owner-row">
              <span className="skill-card-owner">
                {item.ownerHandle ? `@${item.ownerHandle}` : "community"}
              </span>
              {item.isOfficial ? <OfficialBadge /> : null}
            </span>
          </div>
        </div>
        <p className="skill-card-summary">
          {truncateText(item.summary ?? "Plugin package for agent workflows.", 100)}
        </p>
        <CatalogTopicList topics={taxonomy.labels} limit={2} ariaLabel={taxonomy.ariaLabel} />
        <div className="skill-card-footer">
          <div className="skill-card-bottom-row">
            <div className="skill-card-bottom-meta">
              <div className="skill-list-item-meta plugin-card-meta">
                <span className="skill-list-item-meta-item">
                  <Download size={14} aria-hidden="true" /> {downloads}
                </span>
              </div>
            </div>
            {primaryCategory ? (
              <span className="skill-card-category" aria-label="Category">
                <BrowseCategoryIcon
                  slug={primaryCategory.slug}
                  icon={primaryCategory.icon}
                  size={13}
                />
                {primaryCategory.label}
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={pluginHref}
      className="skill-list-item skill-list-item-with-taxonomy"
      aria-label={`Plugin: ${item.displayName}`}
    >
      <MarketplaceIcon kind="plugin" label={item.displayName} imageUrl={item.icon} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-identity">
            <span className="skill-list-item-name" title={item.displayName}>
              {truncateText(item.displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
            </span>
            {item.ownerHandle ? (
              <span className="skill-list-item-owner">@{item.ownerHandle}</span>
            ) : null}
          </span>
          {item.isOfficial ? <OfficialBadge /> : null}
          <CatalogTopicList topics={taxonomy.labels} limit={2} ariaLabel={taxonomy.ariaLabel} />
        </div>
        <p className="skill-list-item-summary">
          {truncateText(item.summary ?? "Plugin package for agent workflows.", 80)}
        </p>
      </div>
      <div className="skill-list-item-taxonomy" aria-label="Category">
        {categoryLabel ? <span className="skill-list-item-category">{categoryLabel}</span> : null}
      </div>
      <div className="skill-list-item-meta">
        <span className="skill-list-item-meta-item">
          <Download size={14} aria-hidden="true" /> {downloads}
        </span>
      </div>
    </Link>
  );
}
