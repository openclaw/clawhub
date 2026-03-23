import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Clock, Package, Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicSkill } from "../lib/publicUser";

type DashboardSkill = PublicSkill & { pendingReview?: boolean };

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const me = useQuery(api.users.me) as Doc<"users"> | null | undefined;
  const publishers = useQuery(api.publishers.listMine) as
    | Array<{
        publisher: {
          _id: string;
          handle: string;
          displayName: string;
          kind: "user" | "org";
        };
        role: "owner" | "admin" | "publisher";
      }>
    | undefined;
  const [selectedPublisherId, setSelectedPublisherId] = useState<string>("");
  const selectedPublisher = publishers?.find((entry) => entry.publisher._id === selectedPublisherId) ?? null;
  const mySkills = useQuery(
    api.skills.list,
    selectedPublisher?.publisher.kind === "user" && me?._id
      ? { ownerUserId: me._id, limit: 100 }
      : selectedPublisherId
        ? { ownerPublisherId: selectedPublisherId as Doc<"publishers">["_id"], limit: 100 }
        : me?._id
        ? { ownerUserId: me._id, limit: 100 }
        : "skip",
  ) as DashboardSkill[] | undefined;

  useEffect(() => {
    if (selectedPublisherId) return;
    const personal = publishers?.find((entry) => entry.publisher.kind === "user") ?? publishers?.[0];
    if (personal?.publisher._id) {
      setSelectedPublisherId(personal.publisher._id);
    }
  }, [publishers, selectedPublisherId]);

  if (!me) {
    return (
      <main className="section">
        <div className="card">Sign in to access your dashboard.</div>
      </main>
    );
  }

  const skills = mySkills ?? [];
  const ownerHandle =
    selectedPublisher?.publisher.handle ?? me.handle ?? me.name ?? me.displayName ?? me._id;

  return (
    <main className="section">
      <div className="dashboard-header">
        <div style={{ display: "grid", gap: "6px" }}>
          <h1 className="section-title" style={{ margin: 0 }}>
            Publisher Skills
          </h1>
          <p className="section-subtitle" style={{ margin: 0 }}>
            New skill versions stay private until automated security checks and verification finish.
          </p>
        </div>
        {publishers && publishers.length > 0 ? (
          <select
            className="input"
            value={selectedPublisherId}
            onChange={(event) => setSelectedPublisherId(event.target.value)}
          >
            {publishers.map((entry) => (
              <option key={entry.publisher._id} value={entry.publisher._id}>
                @{entry.publisher.handle} · {entry.role}
              </option>
            ))}
          </select>
        ) : null}
        <Link to="/upload" search={{ updateSlug: undefined }} className="btn btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Upload New Skill
        </Link>
      </div>

      {skills.length === 0 ? (
        <div className="card dashboard-empty">
          <Package className="dashboard-empty-icon" aria-hidden="true" />
          <h2>No skills yet</h2>
          <p>Upload your first skill to share it with the community.</p>
          <Link to="/upload" search={{ updateSlug: undefined }} className="btn btn-primary">
            <Upload className="h-4 w-4" aria-hidden="true" />
            Upload a Skill
          </Link>
        </div>
      ) : (
        <div className="dashboard-grid">
          {skills.map((skill) => (
            <SkillCard key={skill._id} skill={skill} ownerHandle={ownerHandle} />
          ))}
        </div>
      )}
    </main>
  );
}

function SkillCard({ skill, ownerHandle }: { skill: DashboardSkill; ownerHandle: string | null }) {
  return (
    <div className="dashboard-skill-card">
      <div className="dashboard-skill-info">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <Link
            to="/$owner/$slug"
            params={{ owner: ownerHandle ?? "unknown", slug: skill.slug }}
            className="dashboard-skill-name"
          >
            {skill.displayName}
          </Link>
          <span className="dashboard-skill-slug">/{skill.slug}</span>
          {skill.pendingReview ? (
            <span className="tag tag-pending">
              <Clock className="h-3 w-3" aria-hidden="true" />
              Pending checks
            </span>
          ) : null}
        </div>
        {skill.summary && <p className="dashboard-skill-description">{skill.summary}</p>}
        {skill.pendingReview ? (
          <p className="dashboard-skill-description">
            Hidden until VirusTotal and verification checks finish.
          </p>
        ) : null}
        <div className="dashboard-skill-stats">
          <span>
            <Package size={13} aria-hidden="true" /> {formatCompactStat(skill.stats.downloads)}
          </span>
          <span>★ {formatCompactStat(skill.stats.stars)}</span>
          <span>{skill.stats.versions} v</span>
        </div>
      </div>
      <div className="dashboard-skill-actions">
        <Link to="/upload" search={{ updateSlug: skill.slug }} className="btn btn-sm">
          <Upload className="h-3 w-3" aria-hidden="true" />
          New Version
        </Link>
        <Link
          to="/$owner/$slug"
          params={{ owner: ownerHandle ?? "unknown", slug: skill.slug }}
          className="btn btn-ghost btn-sm"
        >
          View
        </Link>
      </div>
    </div>
  );
}
