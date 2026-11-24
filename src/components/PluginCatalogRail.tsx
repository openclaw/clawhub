import { ArrowUpRight, Pencil, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import {
  buildPluginCategoryBrowseHref,
  buildPluginTopicBrowseHref,
  formatCatalogTopicLabel,
  getPluginCategoryBySlug,
} from "../lib/categories";
import type { PackageDetailResponse, PackageVersionDetail } from "../lib/packageApi";
import { buildPluginSecurityAuditHref } from "../lib/pluginRoutes";
import { GitHubIcon } from "./BrandIcons";
import { CatalogDetailFact } from "./CatalogDetailLayout";
import { DetailSecuritySummary, DetailSecuritySummaryLabel } from "./DetailSecuritySummary";

function repositoryLink(raw: string | undefined) {
  if (!raw) return null;
  const input = /^[\w.-]+\/[\w.-]+$/u.test(raw)
    ? `https://github.com/${raw}`
    : raw.replace(/^git\+/u, "");
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
  const github = url.hostname === "github.com";
  const [owner, repo] = url.pathname.split("/").filter(Boolean);
  const label =
    github && owner && repo
      ? `${owner}/${repo.replace(/\.git$/u, "")}`
      : url.hostname + url.pathname.replace(/\/$/u, "");
  const cut = label.lastIndexOf("/") + 1;
  return (
    <a
      className="plugin-catalog-repo"
      href={github && owner && repo ? `https://github.com/${label}` : url.href}
      target="_blank"
      rel="noopener noreferrer"
      data-analytics-public-detail=""
      title={label}
    >
      {github && <GitHubIcon size={15} />}
      <span className="plugin-catalog-repo__path">
        <span>{label.slice(0, cut)}</span>
        <span>{label.slice(cut)}</span>
      </span>
      <ArrowUpRight size={12} aria-hidden="true" />
    </a>
  );
}

// Same precision as the catalog in Control UI; never substitute a period-specific count.
function compactCount(value: number) {
  if (value < 1_000) return value.toLocaleString("en-US");
  const scale = value >= 999_500_000 ? 1_000_000_000 : value >= 999_500 ? 1_000_000 : 1_000;
  const count = value / scale;
  return (
    String(count >= 100 ? Math.round(count) : Number(count.toFixed(1))) +
    (scale === 1_000 ? "k" : scale === 1_000_000 ? "m" : "b")
  );
}
const serverDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

export function PluginCatalogRail({
  pkg,
  release,
  ownerHandle,
  onEditTopics,
}: {
  pkg: NonNullable<PackageDetailResponse["package"]>;
  release: PackageVersionDetail["version"];
  ownerHandle?: string | null;
  onEditTopics?: () => void;
}) {
  // Hydrate the server's UTC text before switching to the same local calendar as Control UI.
  const [publishedDate, setPublishedDate] = useState(serverDate);
  useEffect(
    () => setPublishedDate(new Intl.DateTimeFormat(undefined, { dateStyle: "medium" })),
    [],
  );
  const categories = (pkg.categories ?? []).flatMap(
    (value) => getPluginCategoryBySlug(value) ?? [],
  );
  const topics = (pkg.topics ?? []).map((topic) => topic.trim()).filter(Boolean);
  const repo = repositoryLink((release?.verification ?? pkg.verification)?.sourceRepo);
  const version = pkg.latestVersion ?? release?.version;
  const blocked =
    pkg.scanStatus === "malicious" || release?.verification?.scanStatus === "malicious";
  return (
    <div className="plugin-catalog-facts" role="group" aria-label="Plugin metadata">
      {release || pkg.latestVersion ? (
        <CatalogDetailFact label={<DetailSecuritySummaryLabel />}>
          <DetailSecuritySummary
            auditHref={buildPluginSecurityAuditHref(pkg.name, {
              ownerHandle: ownerHandle ?? pkg.ownerHandle,
              ...(pkg.latestVersion || !release ? {} : { version: release.version }),
            })}
            llmAnalysis={blocked ? null : release?.llmAnalysis}
            githubScanStatus={blocked ? "malicious" : undefined}
          />
        </CatalogDetailFact>
      ) : null}
      {version ? <CatalogDetailFact label="Version">{version}</CatalogDetailFact> : null}
      <CatalogDetailFact label="Updated">
        <time dateTime={new Date(pkg.updatedAt).toISOString()}>
          {publishedDate.format(pkg.updatedAt)}
        </time>
      </CatalogDetailFact>
      <CatalogDetailFact label="Published">
        <time dateTime={new Date(pkg.createdAt).toISOString()}>
          {publishedDate.format(pkg.createdAt)}
        </time>
      </CatalogDetailFact>
      {pkg.stats ? (
        <CatalogDetailFact label="Downloads">{compactCount(pkg.stats.downloads)}</CatalogDetailFact>
      ) : null}
      {categories.length ? (
        <CatalogDetailFact label="Categories">
          <span className="plugin-catalog-chips" aria-label="Categories">
            {categories.map((category) => (
              <a
                key={category.slug}
                href={buildPluginCategoryBrowseHref(category)}
                aria-label={`View ${category.label} plugins`}
              >
                {category.label}
              </a>
            ))}
          </span>
        </CatalogDetailFact>
      ) : null}
      {repo ? <CatalogDetailFact label="Repository">{repo}</CatalogDetailFact> : null}
      {topics.length || onEditTopics ? (
        <CatalogDetailFact label="Topics">
          <span className="plugin-catalog-chips" aria-label="Topics">
            {topics.map((topic) => (
              <a
                key={topic}
                href={buildPluginTopicBrowseHref(topic)}
                aria-label={`View plugins tagged ${formatCatalogTopicLabel(topic)}`}
              >
                {formatCatalogTopicLabel(topic)}
              </a>
            ))}
            {onEditTopics ? (
              <button
                type="button"
                aria-label={topics.length ? "Edit topics" : "Add topics"}
                onClick={onEditTopics}
              >
                {topics.length ? <Pencil size={12} /> : <Plus size={12} />}{" "}
                {topics.length ? "Edit" : "Add topics"}
              </button>
            ) : null}
          </span>
        </CatalogDetailFact>
      ) : null}
    </div>
  );
}
