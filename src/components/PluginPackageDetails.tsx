import { Ellipsis } from "lucide-react";
import { useRef, useState, useEffect, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

export type PluginDetailTab = "activity" | "configuration" | "compatibility" | "versions";

export function pluginDetailTabFromHash(hash: string): PluginDetailTab | null {
  if (hash === "#verification") return "compatibility";
  const name = hash.slice(1);
  return name === "activity" ||
    name === "configuration" ||
    name === "compatibility" ||
    name === "versions"
    ? name
    : null;
}

// The public registry has release-management and artifact data the Control UI does not.
// Keep it reachable (including existing deep links) without displacing the catalog overview.
export function PluginPackageDetails({
  name,
  downloadHref,
  activeTab,
  onTab,
  activity,
  configuration,
  compatibility,
  versionsPanel,
}: {
  name: string;
  downloadHref: string | null;
  activeTab: PluginDetailTab | null;
  onTab: (tab: PluginDetailTab | null) => void;
  activity: ReactNode;
  configuration: ReactNode;
  compatibility: ReactNode;
  versionsPanel: (hidden: boolean) => ReactNode;
}) {
  const tabs = [
    { id: "activity", label: "Activity", panel: activity },
    ...(configuration
      ? ([{ id: "configuration", label: "Configuration", panel: configuration }] as const)
      : []),
    ...(compatibility
      ? ([{ id: "compatibility", label: "Compatibility", panel: compatibility }] as const)
      : []),
    { id: "versions", label: "Versions", panel: null },
  ] as const;
  const selected = tabs.find((tab) => tab.id === activeTab)?.id ?? "activity";
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const [visitedVersions, setVisitedVersions] = useState(false);
  useEffect(() => {
    if (selected === "versions") setVisitedVersions(true);
  }, [selected]);
  return (
    <Dialog open={activeTab !== null} onOpenChange={(open) => onTab(open ? "activity" : null)}>
      <DialogTrigger asChild>
        <button
          className="plugin-catalog-action plugin-catalog-action--icon"
          type="button"
          aria-label="Package details"
          title="Package details"
        >
          <Ellipsis size={18} aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className="plugin-package-dialog">
        <DialogHeader>
          <DialogTitle>Package details</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        {downloadHref ? (
          <a className="plugin-package-dialog__download" href={downloadHref}>
            Download
          </a>
        ) : null}
        <div role="tablist" aria-label="Plugin detail tabs" className="plugin-package-dialog__tabs">
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={"plugin-tab-" + tab.id}
              aria-controls={"plugin-tabpanel-" + tab.id}
              aria-selected={tab.id === selected}
              tabIndex={tab.id === selected ? 0 : -1}
              onClick={() => onTab(tab.id)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                onTab(tabs[next].id);
                refs.current[next]?.focus();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {tabs.map(
          (tab) =>
            tab.id !== "versions" && (
              <div
                key={tab.id}
                role="tabpanel"
                id={"plugin-tabpanel-" + tab.id}
                aria-labelledby={"plugin-tab-" + tab.id}
                tabIndex={0}
                hidden={tab.id !== selected}
              >
                {tab.id === selected ? tab.panel : null}
              </div>
            ),
        )}
        {visitedVersions || selected === "versions" ? (
          versionsPanel(selected !== "versions")
        ) : (
          <div
            role="tabpanel"
            id="plugin-tabpanel-versions"
            aria-labelledby="plugin-tab-versions"
            hidden
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
