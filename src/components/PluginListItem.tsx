import { Link } from "@tanstack/react-router";
import type { PackageListItem } from "../lib/packageApi";
import { familyLabel } from "../lib/packageLabels";
import { MarketplaceIcon } from "./MarketplaceIcon";
import { Badge } from "./ui/badge";

type PluginListItemProps = {
  item: PackageListItem;
};

function formatHostTarget(value: string) {
  const labels: Record<string, string> = {
    "darwin-arm64": "macOS arm64",
    "darwin-x64": "macOS x64",
    "linux-x64-glibc": "Linux glibc",
    "linux-x64-musl": "Linux musl",
    "win32-x64": "Windows x64",
  };
  return labels[value] ?? value;
}

function formatEnvironmentFlag(value: string) {
  if (value.startsWith("service:")) return value.replace("service:", "");
  if (value.startsWith("permission:")) return value.replace("permission:", "");
  if (value === "remote-host") return "remote host";
  return value;
}

export function PluginListItem({ item }: PluginListItemProps) {
  const hostTargets = item.hostTargetKeys ?? [];
  const environmentFlags = item.environmentFlags ?? [];
  const visibleHostTargets = hostTargets.slice(0, 2);
  const visibleEnvironmentFlags = environmentFlags.slice(0, 2);
  const hiddenSignalCount =
    Math.max(0, hostTargets.length - visibleHostTargets.length) +
    Math.max(0, environmentFlags.length - visibleEnvironmentFlags.length);

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
          {item.isOfficial ? <Badge variant="accent">Verified</Badge> : null}
          {item.clawpackAvailable ? <Badge variant="accent">Claw Pack</Badge> : null}
        </div>
        <p className="skill-list-item-summary">
          {item.summary ?? "Plugin package for agent workflows."}
        </p>
        <div className="skill-list-item-meta">
          <span className="skill-list-item-meta-item">Plugin</span>
          {item.latestVersion ? (
            <span className="skill-list-item-meta-item">v{item.latestVersion}</span>
          ) : null}
          {visibleHostTargets.map((hostTarget) => (
            <span key={hostTarget} className="skill-list-item-meta-item">
              {formatHostTarget(hostTarget)}
            </span>
          ))}
          {visibleEnvironmentFlags.map((flag) => (
            <span key={flag} className="skill-list-item-meta-item">
              {formatEnvironmentFlag(flag)}
            </span>
          ))}
          {hiddenSignalCount > 0 ? (
            <span className="skill-list-item-meta-item">+{hiddenSignalCount}</span>
          ) : null}
          <span className="skill-list-item-meta-item">
            {item.ownerHandle ? `@${item.ownerHandle}` : "community"}
          </span>
        </div>
      </div>
    </Link>
  );
}
