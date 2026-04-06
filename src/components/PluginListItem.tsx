import { Link } from "@tanstack/react-router";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { familyLabel } from "../lib/packageLabels";
import type { PackageListItem } from "../lib/packageApi";

type PluginListItemProps = {
  item: PackageListItem;
};

export function PluginListItem({ item }: PluginListItemProps) {
  return (
    <Link to="/plugins/$name" params={{ name: item.name }} className="skill-list-item">
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
          <span className="tag tag-compact">{familyLabel(item.family)}</span>
          {item.isOfficial ? <span className="tag tag-compact tag-accent">Verified</span> : null}
        </div>
        <p className="skill-list-item-summary">{item.summary ?? "Plugin package for agent workflows."}</p>
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
