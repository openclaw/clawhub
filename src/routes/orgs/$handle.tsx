import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { PublicPublisher, PublicSkill } from "../../lib/publicUser";
import { SkillCard } from "../../components/SkillCard";
import { getSkillBadges } from "../../lib/badges";
import { SkillStatsTripletLine } from "../../components/SkillStats";

export const Route = createFileRoute("/orgs/$handle")({
  component: OrgProfile,
});

function OrgProfile() {
  const { handle } = Route.useParams();
  const publisher = useQuery(api.publishers.getByHandle, { handle }) as
    | PublicPublisher
    | null
    | undefined;
  const members = useQuery(api.publishers.listMembers, { publisherHandle: handle }) as
    | {
        publisher: PublicPublisher | null;
        members: Array<{
          role: "owner" | "admin" | "publisher";
          user: {
            _id: string;
            handle: string | null;
            displayName: string | null;
            image: string | null;
          };
        }>;
      }
    | null
    | undefined;
  const skills = useQuery(
    api.skills.list,
    publisher ? { ownerPublisherId: publisher._id, limit: 50 } : "skip",
  ) as PublicSkill[] | undefined;

  if (publisher === undefined) {
    return (
      <main className="section">
        <div className="card">Loading org…</div>
      </main>
    );
  }

  if (!publisher || publisher.kind !== "org") {
    return (
      <main className="section">
        <div className="card">Organization not found.</div>
      </main>
    );
  }

  return (
    <main className="section">
      <div className="card settings-profile" style={{ marginBottom: 22 }}>
        <div className="settings-avatar" aria-hidden="true">
          {publisher.image ? (
            <img src={publisher.image} alt="" />
          ) : (
            <span>{publisher.displayName.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="settings-profile-body">
          <div className="settings-name">{publisher.displayName}</div>
          <div className="settings-handle">@{publisher.handle}</div>
          {publisher.bio ? <div className="section-subtitle">{publisher.bio}</div> : null}
        </div>
      </div>

      <h2 className="section-title" style={{ fontSize: "1.3rem" }}>
        Published
      </h2>
      {(skills ?? []).length ? (
        <div className="grid" style={{ marginBottom: 18 }}>
          {(skills ?? []).map((skill) => (
            <SkillCard
              key={skill._id}
              skill={skill}
              href={`/${encodeURIComponent(publisher.handle)}/${encodeURIComponent(skill.slug)}`}
              badge={getSkillBadges(skill)}
              trustedPublisher={Boolean(publisher.trustedPublisher)}
              verifiedPublisher={Boolean(publisher.verifiedPublisher)}
              summaryFallback="Agent-ready skill pack."
              meta={
                <div className="stat">
                  <SkillStatsTripletLine stats={skill.stats} />
                </div>
              }
            />
          ))}
        </div>
      ) : (
        <div className="card">No published skills yet.</div>
      )}

      <h2 className="section-title" style={{ fontSize: "1.3rem" }}>
        Members
      </h2>
      {(members?.members ?? []).length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {members?.members.map((entry) => (
            <div key={`${entry.user._id}:${entry.role}`} className="card">
              <strong>{entry.user.displayName ?? entry.user.handle ?? "User"}</strong>
              <div className="section-subtitle" style={{ margin: "6px 0 0" }}>
                {entry.user.handle ? (
                  <Link to="/u/$handle" params={{ handle: entry.user.handle }}>
                    @{entry.user.handle}
                  </Link>
                ) : (
                  "user"
                )}{" "}
                · {entry.role}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">No members listed.</div>
      )}
    </main>
  );
}
