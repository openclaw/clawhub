import { Link } from "@tanstack/react-router";
import { isPluginCategorySlug } from "clawhub-schema/catalogMetadata";
import { Download } from "lucide-react";
import { emitAnalytics, publicAnalyticsContentId } from "../lib/analyticsEvents";
import { BrowseCategoryIcon } from "../lib/browseCategoryIcons";
import { getPluginCategoryBySlug } from "../lib/categories";
import { formatCompactStat } from "../lib/numberFormat";
import type { PackageListItem } from "../lib/packageApi";
import { buildPluginDetailHref } from "../lib/pluginRoutes";
import { presentationTitle } from "../lib/presentationTitle";
import { themeChipStyle, themeModeFor, useSiteThemeMode } from "../lib/themePreviewTokens";
import { PUBLIC_CATALOG_NAME_PREVIEW_LENGTH, truncateText } from "../lib/truncateText";
import { CatalogTopicList } from "./CatalogTopicList";
import { InlineMarkdownSummary } from "./InlineMarkdownSummary";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { OfficialBadge } from "./OfficialBadge";
import { ThemePreviewWindow } from "./ThemePreviewWindow";

type PluginListItemProps = {
  item: PackageListItem;
  variant?: "list" | "card";
  href?: string;
  showOfficialBadge?: boolean;
};

function getPluginTaxonomyDisplay(item: PackageListItem) {
  const topics = (item.topics ?? []).filter((topic) => topic.trim());
  if (topics.length > 0) return { labels: topics, ariaLabel: "Topics" };

  const categories = (item.categories ?? []).flatMap((category) => {
    return isPluginCategorySlug(category) && getPluginCategoryBySlug(category) ? [category] : [];
  });
  return { labels: categories, ariaLabel: "Categories" };
}

function getPluginCategories(item: PackageListItem) {
  return (item.categories ?? []).flatMap((slug) => {
    if (!isPluginCategorySlug(slug)) return [];
    const category = getPluginCategoryBySlug(slug);
    return category ? [category] : [];
  });
}

export function PluginListItem({
  item,
  variant = "list",
  href,
  showOfficialBadge = true,
}: PluginListItemProps) {
  const isOfficial = item.isOfficial || item.ownerOfficial === true;
  const downloads = formatCompactStat(item.stats?.downloads ?? 0);
  const taxonomy = getPluginTaxonomyDisplay(item);
  const categories = getPluginCategories(item);
  const primaryCategory = categories[0] ?? null;
  const pluginHref = href ?? buildPluginDetailHref(item.name, { ownerHandle: item.ownerHandle });
  const displayName = presentationTitle(item.displayName, item.name);
  const siteMode = useSiteThemeMode();
  const recordSelection = () => {
    if (item.channel === "official" || item.channel === "community")
      emitAnalytics("select_content", {
        content_type: "plugin",
        content_id: publicAnalyticsContentId("plugin", item.name),
        ui_location: "catalog",
      });
  };

  // Theme-only packs read better as a grid of previews than as list rows.
  if (item.themePreview && item.themeChips?.length) {
    return (
      <div className="theme-pack-card plugin-summary-item">
        <Link
          to={pluginHref}
          onClick={recordSelection}
          className="plugin-detail-link"
          aria-label={`Theme pack: ${displayName}`}
        />
        <ThemePreviewWindow
          theme={item.themePreview}
          mode={themeModeFor(item.themePreview, siteMode)}
          size="card"
        />
        <div className="theme-pack-card-meta">
          <h3 title={displayName}>
            {truncateText(displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
          </h3>
          <span>{item.ownerHandle ? `by @${item.ownerHandle}` : "community"}</span>
        </div>
        <ul className="theme-pack-card-chips" aria-label="Themes in this pack">
          {item.themeChips.map((chip) => (
            <li key={chip.id} className="theme-chip" style={themeChipStyle(chip)} title={chip.name}>
              <i />
              <i />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className="card skill-card plugin-card plugin-summary-item">
        <Link
          to={pluginHref}
          onClick={recordSelection}
          className="plugin-detail-link"
          aria-label={`Plugin: ${displayName}`}
        />
        <div className="skill-card-header">
          <MarketplaceIcon
            kind="plugin"
            label={displayName}
            imageUrl={item.icon}
            rasterAssetUrl={item.iconAssetUrl}
            publisherImageUrl={item.ownerImage}
            categorySlug={primaryCategory?.slug}
            size="md"
          />
          <div className="skill-card-identity">
            <h3 className="skill-card-title" title={displayName}>
              {truncateText(displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
            </h3>
            <span className="skill-card-owner-row">
              <span className="skill-card-owner">
                {item.ownerHandle ? `@${item.ownerHandle}` : "community"}
              </span>
              {showOfficialBadge && isOfficial ? <OfficialBadge /> : null}
            </span>
          </div>
        </div>
        <p className="skill-card-summary plugin-summary">
          <InlineMarkdownSummary>
            {item.summary ?? "Plugin package for agent workflows."}
          </InlineMarkdownSummary>
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
      </div>
    );
  }

  return (
    <div className="skill-list-item plugin-summary-item">
      <Link
        to={pluginHref}
        onClick={recordSelection}
        className="plugin-detail-link"
        aria-label={`Plugin: ${displayName}`}
      />
      <MarketplaceIcon
        kind="plugin"
        label={displayName}
        imageUrl={item.icon}
        rasterAssetUrl={item.iconAssetUrl}
        publisherImageUrl={item.ownerImage}
        categorySlug={primaryCategory?.slug}
      />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          <span className="skill-list-item-identity">
            <span className="skill-list-item-name" title={displayName}>
              {truncateText(displayName, PUBLIC_CATALOG_NAME_PREVIEW_LENGTH)}
            </span>
            {item.ownerHandle ? (
              <span className="skill-list-item-owner">@{item.ownerHandle}</span>
            ) : null}
          </span>
          {showOfficialBadge && isOfficial ? <OfficialBadge /> : null}
          <CatalogTopicList topics={taxonomy.labels} limit={2} ariaLabel={taxonomy.ariaLabel} />
        </div>
        <p className="skill-list-item-summary plugin-summary">
          <InlineMarkdownSummary>
            {item.summary ?? "Plugin package for agent workflows."}
          </InlineMarkdownSummary>
        </p>
      </div>
      <div className="skill-list-item-meta">
        <span className="skill-list-item-meta-item">
          <Download size={14} aria-hidden="true" /> {downloads}
        </span>
      </div>
    </div>
  );
}

/**
 * Plugin results for a list container: theme-only packs render as grid cards, and runs of
 * them are grouped into one grid; every other plugin keeps its list row in place.
 */
export function PluginResultItems({ items }: { items: readonly PackageListItem[] }) {
  const groups: PackageListItem[][] = [];
  for (const item of items) {
    const isPack = Boolean(item.themePreview && item.themeChips?.length);
    const last = groups.at(-1);
    const lastIsPack = Boolean(last?.[0]?.themePreview && last[0].themeChips?.length);
    if (isPack && lastIsPack) last!.push(item);
    else groups.push([item]);
  }
  return groups.map((group) =>
    group[0]?.themePreview && group[0].themeChips?.length ? (
      <div key={`themes-${group[0].name}`} className="theme-pack-grid">
        {group.map((item) => (
          <PluginListItem key={item.name} item={item} />
        ))}
      </div>
    ) : (
      <PluginListItem key={group[0]!.name} item={group[0]!} variant="list" />
    ),
  );
}
