import { Link } from "@tanstack/react-router";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { familyLabel } from "../../lib/packageLabels";
import { buildPluginDetailHref } from "../../lib/pluginRoutes";
import { formatTimestamp, type PluginByNameResult } from "./managementShared";

type PluginPackageId = NonNullable<NonNullable<PluginByNameResult>["package"]>["_id"];

export function PluginsPage({
  pluginSearch,
  selectedPlugin,
  selectedPluginName,
  onChangePluginSearch,
  onManagePlugin,
  onSetPackageBatch,
}: {
  pluginSearch: string;
  selectedPlugin: PluginByNameResult | undefined;
  selectedPluginName: string | undefined;
  onChangePluginSearch: (value: string) => void;
  onManagePlugin: () => void;
  onSetPackageBatch: (packageId: PluginPackageId, batch: "highlighted" | undefined) => void;
}) {
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">Plugin tools</h2>
      <p className="section-subtitle m-0 mt-1">
        Look up a plugin package to open its moderation tooling.
      </p>
      <div className="management-controls">
        <div className="management-control management-search">
          <span className="mono">Package</span>
          <input
            type="search"
            placeholder="@scope/plugin-name or package-name"
            value={pluginSearch}
            onChange={(event) => onChangePluginSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onManagePlugin();
              }
            }}
          />
        </div>
        <Button type="button" onClick={onManagePlugin} disabled={!pluginSearch.trim()}>
          Manage
        </Button>
      </div>
      {selectedPluginName ? (
        <div className="section-subtitle mt-2">
          Managing "{selectedPluginName}" ·{" "}
          <Link
            to="/management"
            search={{
              view: "plugins",
              skill: undefined,
              plugin: undefined,
            }}
          >
            Clear selection
          </Link>
        </div>
      ) : null}
      <div className="management-list">
        {!selectedPluginName ? (
          <div className="management-empty">Enter a plugin package name to open tooling here.</div>
        ) : selectedPlugin === undefined ? (
          <div className="management-empty">Loading plugin…</div>
        ) : !selectedPlugin?.package ? (
          <div className="management-empty">No plugin found for "{selectedPluginName}".</div>
        ) : (
          (() => {
            const plugin = selectedPlugin.package;
            const owner = selectedPlugin.owner;
            const latestRelease = selectedPlugin.latestRelease;
            const isHighlighted = Boolean(selectedPlugin.highlighted);
            const pluginHref = buildPluginDetailHref(plugin.name, { ownerHandle: owner?.handle });

            return (
              <div key={plugin._id} className="management-item management-item-detail">
                <div className="management-item-main">
                  <Link to={pluginHref}>{plugin.displayName}</Link>
                  <div className="section-subtitle m-0">
                    {owner?.handle ? `@${owner.handle}` : "unknown owner"} ·{" "}
                    {familyLabel(plugin.family)} · v{latestRelease?.version ?? "—"} · updated{" "}
                    {formatTimestamp(plugin.updatedAt)}
                    {plugin.softDeletedAt ? " · hidden" : ""}
                    {isHighlighted ? " · highlighted" : ""}
                  </div>
                  <div className="management-tags">
                    <Badge>{plugin.channel}</Badge>
                    {plugin.isOfficial ? <Badge variant="official">Verified</Badge> : null}
                    {plugin.runtimeId ? <Badge>{plugin.runtimeId}</Badge> : null}
                  </div>
                  <div className="management-sublist">
                    <div className="management-report-item">
                      <span className="management-report-meta">Package name</span>
                      <span className="mono">{plugin.name}</span>
                    </div>
                    <div className="management-report-item">
                      <span className="management-report-meta">Summary</span>
                      <span>{plugin.summary ?? "No summary provided."}</span>
                    </div>
                    <div className="management-report-item">
                      <span className="management-report-meta">Featured state</span>
                      <span>
                        {isHighlighted
                          ? `Highlighted ${formatTimestamp(selectedPlugin.highlighted?.at ?? 0)}`
                          : "Not highlighted"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="management-actions management-action-grid">
                  <Button asChild className="management-action-btn">
                    <Link to={pluginHref}>View</Link>
                  </Button>
                  <Button
                    className="management-action-btn"
                    type="button"
                    onClick={() =>
                      onSetPackageBatch(plugin._id, isHighlighted ? undefined : "highlighted")
                    }
                  >
                    {isHighlighted ? "Unhighlight" : "Highlight"}
                  </Button>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
