import { Link } from "@tanstack/react-router";
import { Button } from "../../components/ui/button";
import {
  formatShortTimestamp,
  resolveOwnerParam,
  type RecentVersionEntry,
} from "./managementShared";

export function RecentPushesPage({
  recentVersions,
}: {
  recentVersions: RecentVersionEntry[] | undefined;
}) {
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">Recent pushes</h2>
      <p className="section-subtitle m-0 mt-1">
        The latest skill versions published across ClawHub.
      </p>
      <div className="management-list">
        {!recentVersions ? (
          <div className="management-empty">Loading recent pushes…</div>
        ) : recentVersions.length === 0 ? (
          <div className="management-empty">No recent versions.</div>
        ) : (
          recentVersions.map((entry) => (
            <div key={entry.version._id} className="management-item">
              <div className="management-item-main">
                <strong>{entry.skill?.displayName ?? "Unknown skill"}</strong>
                <div className="section-subtitle m-0">
                  v{entry.version.version} · @{entry.owner?.handle ?? entry.owner?.name ?? "user"} ·{" "}
                  {formatShortTimestamp(entry.version._creationTime)}
                </div>
              </div>
              <div className="management-actions">
                {entry.skill ? (
                  <Button asChild>
                    <Link
                      to="/management"
                      search={{
                        view: "skills",
                        skill: entry.skill.slug,
                        plugin: undefined,
                      }}
                    >
                      Manage
                    </Link>
                  </Button>
                ) : null}
                {entry.skill ? (
                  <Button asChild>
                    <Link
                      to="/$owner/skills/$slug"
                      params={{
                        owner: resolveOwnerParam(
                          entry.owner?.handle ?? null,
                          entry.owner?._id ?? entry.skill.ownerUserId,
                        ),
                        slug: entry.skill.slug,
                      }}
                    >
                      View
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
