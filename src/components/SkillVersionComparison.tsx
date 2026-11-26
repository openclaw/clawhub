import { useQuery } from "convex/react";
import { lazy, Suspense, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";

const SkillDiffCard = lazy(() =>
  import("./SkillDiffCard").then((module) => ({ default: module.SkillDiffCard })),
);

// Comparison is a management tool, not a file explorer on the public listing.
export function SkillVersionComparison({ skill }: { skill: Pick<Doc<"skills">, "_id" | "tags"> }) {
  const [open, setOpen] = useState(false);
  const versions = useQuery(
    api.skills.listVersions,
    open ? { skillId: skill._id, limit: 200 } : "skip",
  );
  const loading = <p role="status">Loading version comparison…</p>;
  return (
    <details className="card" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Compare versions</summary>
      {open &&
        (versions ? (
          <Suspense fallback={loading}>
            <SkillDiffCard skill={skill} versions={versions} variant="embedded" />
          </Suspense>
        ) : (
          loading
        ))}
    </details>
  );
}
