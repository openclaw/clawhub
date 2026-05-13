import { Link } from "@tanstack/react-router";
import type { PackageListItem } from "../lib/packageApi";
import { familyLabel } from "../lib/packageLabels";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Badge } from "./ui/badge";
import { VerifiedBadge } from "./VerifiedBadge";

type PluginListItemProps = {
  item: PackageListItem;
  variant?: "list" | "card";
};

export function PluginListItem({ item, variant = "list" }: PluginListItemProps) {
  if (variant === "card") {
    return (
      <Link
        to="/plugins/$name"
        params={{ name: item.name }}
        className="card skill-card plugin-card"
        aria-label={`Plugin: ${item.displayName}`}
      >
        <div className="skill-card-tags">
          <Badge variant="compact">{familyLabel(item.family)}</Badge>
          {item.isOfficial ? <VerifiedBadge /> : null}
        </div>
        <div className="skill-card-header">
          <MarketplaceIcon kind="plugin" label={item.displayName} size="md" />
          <h3 className="skill-card-title">{item.displayName}</h3>
        </div>
        <p className="skill-card-summary">
          {item.summary ?? "Plugin package for agent workflows."}
        </p>
        <div className="skill-card-footer">
          <div className="skill-list-item-meta plugin-card-meta">
            <span className="skill-list-item-meta-item">Plugin</span>
            {item.latestVersion ? (
              <span className="skill-list-item-meta-item">v{item.latestVersion}</span>
            ) : null}
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
      <MarketplaceIcon kind="plugin" label={item.displayName} />
      <div className="skill-list-item-body">
        <div className="skill-list-item-main">
          {item.ownerHandle ? (
            <>
              <span className="skill-list-item-owner">@{item.ownerHandle}</span>
              <span className="skill-list-item-sep">/</span>
            </>
          ) : null}
          <span className="skill-list-item-name">{item.displayName}</span>
          <Badge variant="compact">{familyLabel(item.family)}</Badge>
          {item.isOfficial ? <VerifiedBadge /> : null}
        </div>
        <p className="skill-list-item-summary">
          {item.summary ?? "Plugin package for agent workflows."}
        </p>
        <div className="skill-list-item-meta">
          <span className="skill-list-item-meta-item">Plugin</span>
          {item.latestVersion ? (
            <span className="skill-list-item-meta-item">v{item.latestVersion}</span>
          ) : null}
          <span className="skill-list-item-meta-item">
            {item.ownerHandle ? `@${item.ownerHandle}` : "community"}
          </span>
        </div>
      </div>
    </Link>
  );
}
