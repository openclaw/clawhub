import type { ApiV1PackageVersionListResponse } from "clawhub-schema";
import { getPackageDownloadPath } from "../lib/packageApi";
import { Badge } from "./ui/badge";

type PluginVersionsPanelProps = {
  packageName: string;
  versions: ApiV1PackageVersionListResponse["items"] | null | undefined;
};

export function PluginVersionsPanel({ packageName, versions }: PluginVersionsPanelProps) {
  const isUnavailable = versions == null;
  const releases = versions ?? [];

  return (
    <div className="grid max-w-full gap-5 overflow-x-auto">
      <div>
        <h2 className="m-0 font-display text-[1.2rem] font-bold text-[color:var(--ink)]">
          Versions
        </h2>
        <p className="m-0 text-sm text-[color:var(--ink-soft)]">
          Review active release history and changelog.
        </p>
      </div>
      {isUnavailable ? (
        <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
          <p className="empty-state-title">Release history is temporarily unavailable.</p>
          <p className="empty-state-body">Try again later.</p>
        </div>
      ) : releases.length > 0 ? (
        <div className="max-h-[600px] overflow-y-auto">
          <div className="flex flex-col gap-3">
            {releases.map((release) => (
              <div
                key={release.version}
                className="flex items-start justify-between gap-4 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div>
                    v{release.version} · {new Date(release.createdAt).toLocaleDateString()}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-[color:var(--ink-soft)]">
                    {release.changelog}
                  </div>
                  {release.distTags && release.distTags.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {release.distTags.map((tag) => (
                        <Badge key={tag} variant="compact">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <a
                    href={getPackageDownloadPath(packageName, release.version)}
                    className="inline-flex min-h-[34px] items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] border border-[color:var(--line)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] no-underline transition-all duration-200"
                  >
                    Zip
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-state px-[var(--space-4)] py-[var(--space-6)]">
          <p className="empty-state-title">No active releases are available.</p>
        </div>
      )}
    </div>
  );
}
