import { Link } from "@tanstack/react-router";
import { Button } from "../../components/ui/button";
import { resolveOwnerParam, type DuplicateCandidateEntry } from "./managementShared";

type DuplicateSkillId = DuplicateCandidateEntry["skill"]["_id"];

export function DuplicatesPage({
  duplicateCandidates,
  onSetDuplicate,
}: {
  duplicateCandidates: DuplicateCandidateEntry[] | undefined;
  onSetDuplicate: (skillId: DuplicateSkillId, canonicalSkillId: DuplicateSkillId) => void;
}) {
  return (
    <div className="management-view">
      <h2 className="section-title text-[1.2rem] m-0">Duplicate candidates</h2>
      <p className="section-subtitle m-0 mt-1">
        Skills whose code fingerprint matches another publisher's — possible copies. Pick the
        canonical original.
      </p>
      <div className="management-list">
        {!duplicateCandidates ? (
          <div className="management-empty">Loading duplicate candidates…</div>
        ) : duplicateCandidates.length === 0 ? (
          <div className="management-empty">No duplicate candidates.</div>
        ) : (
          duplicateCandidates.map((entry) => (
            <div key={entry.skill._id} className="management-item management-dupe">
              <div className="management-dupe-head">
                <div className="management-item-main">
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
                    {entry.skill.displayName}
                  </Link>
                  <div className="section-subtitle m-0">
                    @{entry.owner?.handle ?? entry.owner?.name ?? "user"} · v
                    {entry.latestVersion?.version ?? "—"} ·{" "}
                    <span className="management-fingerprint">
                      {entry.fingerprint ? entry.fingerprint.slice(0, 8) : "—"}
                    </span>
                  </div>
                </div>
                <div className="management-actions">
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
                </div>
              </div>
              <div className="management-dupe-matches">
                <div className="management-dupe-label">
                  {entry.matches.length === 1 ? "Possible duplicate of" : "Possible duplicates of"}
                </div>
                {entry.matches.map((match) => (
                  <div key={match.skill._id} className="management-dupe-match">
                    <div className="management-item-main">
                      <strong>{match.skill.displayName}</strong>
                      <div className="section-subtitle m-0">
                        @{match.owner?.handle ?? match.owner?.name ?? "user"} · {match.skill.slug}
                      </div>
                    </div>
                    <div className="management-actions">
                      <Button asChild>
                        <Link
                          to="/$owner/skills/$slug"
                          params={{
                            owner: resolveOwnerParam(
                              match.owner?.handle ?? null,
                              match.owner?._id ?? match.skill.ownerUserId,
                            ),
                            slug: match.skill.slug,
                          }}
                        >
                          View
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        onClick={() => onSetDuplicate(entry.skill._id, match.skill._id)}
                      >
                        Mark duplicate
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
