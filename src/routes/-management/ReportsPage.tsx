import { Link } from "@tanstack/react-router";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "../../components/ui/button";
import { formatTimestamp, resolveOwnerParam, type ReportedSkillEntry } from "./managementShared";

export function ReportsPage({
  admin,
  items,
  reportCountLabel,
  search,
  summary,
  onChangeSearch,
  onHardDeleteSkill,
  onToggleSkillHidden,
}: {
  admin: boolean;
  items: ReportedSkillEntry[] | undefined;
  reportCountLabel: string;
  search: string;
  summary: string;
  onChangeSearch: (value: string) => void;
  onHardDeleteSkill: (skill: Doc<"skills">) => void;
  onToggleSkillHidden: (skill: Doc<"skills">) => void;
}) {
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">Reported skills</h2>
      <p className="section-subtitle m-0 mt-1">
        Skills the community has flagged. Review each report and take action.
      </p>
      <div className="management-controls">
        <div className="management-control management-search">
          <span className="mono">Filter</span>
          <input
            type="search"
            placeholder="Search reported skills"
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </div>
        <div className="management-count">{summary}</div>
      </div>
      <div className="management-list">
        {!items ? (
          <div className="management-empty">Loading reports…</div>
        ) : items.length === 0 ? (
          <div className="management-empty">{reportCountLabel}</div>
        ) : (
          items.map((entry) => {
            const { skill, latestVersion, owner, reports } = entry;
            const ownerParam = resolveOwnerParam(
              owner?.handle ?? null,
              owner?._id ?? skill.ownerUserId,
            );
            const reportEntries = reports ?? [];
            return (
              <div key={skill._id} className="management-item">
                <div className="management-item-main">
                  <Link to="/$owner/skills/$slug" params={{ owner: ownerParam, slug: skill.slug }}>
                    {skill.displayName}
                  </Link>
                  <div className="section-subtitle m-0">
                    @{owner?.handle ?? owner?.name ?? "user"} · v{latestVersion?.version ?? "—"} ·
                    {skill.reportCount ?? 0} report
                    {(skill.reportCount ?? 0) === 1 ? "" : "s"}
                    {skill.lastReportedAt ? ` · last ${formatTimestamp(skill.lastReportedAt)}` : ""}
                  </div>
                  {reportEntries.length > 0 ? (
                    <div className="management-sublist">
                      {reportEntries.map((report) => (
                        <div
                          key={`${report.reporterId}-${report.createdAt}`}
                          className="management-report-item"
                        >
                          <span className="management-report-meta">
                            {formatTimestamp(report.createdAt)}
                            {report.reporterHandle ? ` · @${report.reporterHandle}` : ""}
                          </span>
                          <span>{report.reason}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="section-subtitle m-0">No report reasons yet.</div>
                  )}
                </div>
                <div className="management-actions">
                  <Button asChild>
                    <Link
                      to="/management"
                      search={{
                        view: "skills",
                        skill: skill.slug,
                        plugin: undefined,
                      }}
                    >
                      Manage
                    </Link>
                  </Button>
                  <Button type="button" onClick={() => onToggleSkillHidden(skill)}>
                    {skill.softDeletedAt ? "Restore" : "Hide"}
                  </Button>
                  {admin ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => onHardDeleteSkill(skill)}
                    >
                      Hard delete
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
