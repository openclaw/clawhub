import type { Doc } from "../../convex/_generated/dataModel";
import { getRuntimeEnv } from "../lib/runtimeEnv";
import { type LlmAnalysis, SecurityScanResults } from "./SkillSecurityScanResults";

type SkillVersionsPanelProps = {
  versions: Doc<"skillVersions">[] | undefined;
  nixPlugin: boolean;
  skillSlug: string;
  suppressScanResults: boolean;
  suppressedMessage: string | null;
};

export function SkillVersionsPanel({
  versions,
  nixPlugin,
  skillSlug,
  suppressScanResults,
  suppressedMessage,
}: SkillVersionsPanelProps) {
  const convexSiteUrl = getRuntimeEnv("VITE_CONVEX_SITE_URL") ?? "https://clawhub.ai";
  return (
    <div className="grid max-w-full gap-5 overflow-x-auto">
      <div>
        <h2 className="m-0 font-display text-[1.2rem] font-bold text-[color:var(--ink)]">
          Versions
        </h2>
        <p className="m-0 text-sm text-[color:var(--ink-soft)]">
          {nixPlugin
            ? "Review release history and changelog."
            : "Download older releases or scan the changelog."}
        </p>
        {suppressedMessage ? (
          <p className="text-sm text-[color:var(--ink-soft)]">{suppressedMessage}</p>
        ) : null}
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        <div className="flex flex-col gap-3">
          {(versions ?? []).map((version) => (
            <div
              key={version._id}
              className="flex items-start justify-between gap-4 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div>
                  v{version.version} · {new Date(version.createdAt).toLocaleDateString()}
                  {version.changelogSource === "auto" ? (
                    <span className="text-[color:var(--ink-soft)]"> · auto</span>
                  ) : null}
                </div>
                <div className="whitespace-pre-wrap break-words text-[color:var(--ink-soft)]">
                  {version.changelog}
                </div>
                <div className="pt-1">
                  {!suppressScanResults && (version.sha256hash || version.llmAnalysis) ? (
                    <SecurityScanResults
                      sha256hash={version.sha256hash}
                      vtAnalysis={version.vtAnalysis}
                      llmAnalysis={version.llmAnalysis as LlmAnalysis | undefined}
                      variant="badge"
                    />
                  ) : null}
                </div>
              </div>
              {!nixPlugin ? (
                <div className="shrink-0">
                  <a
                    href={`${convexSiteUrl}/api/v1/download?slug=${skillSlug}&version=${version.version}`}
                    className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold text-xs min-h-[34px] rounded-[var(--radius-pill)] px-3 py-1.5 border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)] transition-all duration-200 no-underline"
                  >
                    Zip
                  </a>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
