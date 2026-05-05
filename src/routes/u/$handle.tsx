import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { SkillListItem } from "../../components/SkillListItem";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import type { PublicSkill, PublicUser } from "../../lib/publicUser";

export const Route = createFileRoute("/u/$handle")({
  component: UserProfile,
});

function UserProfile() {
  const { handle } = Route.useParams();
  const me = useQuery(api.users.me) as Doc<"users"> | null | undefined;
  const user = useQuery(api.users.getByHandle, { handle }) as PublicUser | null | undefined;
  const publishedSkills = useQuery(
    api.skills.list,
    user ? { ownerUserId: user._id, limit: 50 } : "skip",
  ) as PublicSkill[] | undefined;
  const starredSkills = useQuery(
    api.stars.listByUser,
    user ? { userId: user._id, limit: 50 } : "skip",
  ) as PublicSkill[] | undefined;

  const isSelf = Boolean(me && user && me._id === user._id);
  const [tab, setTab] = useState<"stars" | "installed">("stars");
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const installed = useQuery(
    api.telemetry.getMyInstalled,
    isSelf && tab === "installed" ? { includeRemoved } : "skip",
  ) as TelemetryResponse | null | undefined;

  useEffect(() => {
    if (!isSelf && tab === "installed") setTab("stars");
  }, [isSelf, tab]);

  if (user === undefined) {
    return (
      <main className="section">
        <Card>
          <div className="loading-indicator">Loading user…</div>
        </Card>
      </main>
    );
  }

  if (user === null) {
    return (
      <main className="section">
        <Card>User not found.</Card>
      </main>
    );
  }

  const avatar = user.image;
  const displayName = user.displayName ?? user.name ?? user.handle ?? "User";
  const displayHandle = user.handle ?? user.name ?? handle;
  const initial = displayName.charAt(0).toUpperCase();
  const isLoadingSkills = starredSkills === undefined;
  const skills = starredSkills ?? [];
  const isLoadingPublished = publishedSkills === undefined;
  const published = publishedSkills ?? [];

  return (
    <main className="browse-page">
      <div className="profile-header">
        <div className="profile-avatar-lg" aria-hidden="true">
          {avatar ? <img src={avatar} alt="" /> : <span>{initial}</span>}
        </div>
        <div className="profile-info">
          <h1 className="profile-display-name">{displayName}</h1>
          <span className="profile-handle">@{displayHandle}</span>
          <div className="profile-stats-row">
            <span className="profile-stat">{published.length} published</span>
            <span className="profile-stat">{skills.length} stars</span>
          </div>
        </div>
      </div>

      {isSelf ? (
        <div className="profile-tabs" role="tablist" aria-label="Profile tabs">
          <button
            className={tab === "stars" ? "profile-tab is-active" : "profile-tab"}
            type="button"
            role="tab"
            aria-selected={tab === "stars"}
            onClick={() => setTab("stars")}
          >
            Overview
          </button>
          <button
            className={tab === "installed" ? "profile-tab is-active" : "profile-tab"}
            type="button"
            role="tab"
            aria-selected={tab === "installed"}
            onClick={() => setTab("installed")}
          >
            Installed
          </button>
        </div>
      ) : null}

      {tab === "installed" && isSelf ? (
        <InstalledSection
          includeRemoved={includeRemoved}
          onToggleRemoved={() => setIncludeRemoved((value) => !value)}
          data={installed}
        />
      ) : (
        <>
          {published.length > 0 ? (
            <>
              <h2 className="home-section-title mb-3">Published ({published.length})</h2>
              {isLoadingPublished ? (
                <Card>
                  <div className="loading-indicator">Loading published skills...</div>
                </Card>
              ) : (
                <div className="results-list mb-6">
                  {published.map((skill) => (
                    <SkillListItem key={skill._id} skill={skill} />
                  ))}
                </div>
              )}
            </>
          ) : null}

          <h2 className="home-section-title mb-3">Stars ({skills.length})</h2>
          {isLoadingSkills ? (
            <Card>
              <div className="loading-indicator">Loading stars...</div>
            </Card>
          ) : skills.length === 0 ? (
            <Card>No stars yet.</Card>
          ) : (
            <div className="results-list">
              {skills.map((skill) => (
                <SkillListItem key={skill._id} skill={skill} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function InstalledSection(props: {
  includeRemoved: boolean;
  onToggleRemoved: () => void;
  data: TelemetryResponse | null | undefined;
}) {
  const clearTelemetry = useMutation(api.telemetry.clearMyTelemetry);
  const [showRaw, setShowRaw] = useState(false);
  const data = props.data;
  if (data === undefined) {
    return (
      <>
        <h2 className="section-title text-xl">Installed</h2>
        <Card>
          <div className="loading-indicator">Loading telemetry…</div>
        </Card>
      </>
    );
  }

  if (data === null) {
    return (
      <>
        <h2 className="section-title text-xl">Installed</h2>
        <Card>Sign in to view your installed skills.</Card>
      </>
    );
  }

  return (
    <>
      <h2 className="section-title text-xl">Installed</h2>
      <p className="section-subtitle max-w-[760px]">
        Private view. Only you can see your folders/roots. Everyone else only sees aggregated
        install counts per skill.
      </p>
      <div className="profile-actions">
        <Button type="button" onClick={props.onToggleRemoved}>
          {props.includeRemoved ? "Hide removed" : "Show removed"}
        </Button>
        <Button type="button" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? "Hide JSON" : "Show JSON"}
        </Button>
        <Button
          type="button"
          onClick={() => {
            if (!window.confirm("Delete all telemetry data?")) return;
            void clearTelemetry();
          }}
        >
          Delete telemetry
        </Button>
      </div>

      {showRaw ? (
        <Card className="telemetry-json mb-4">
          <pre className="mono m-0 whitespace-pre-wrap">{JSON.stringify(data, null, 2)}</pre>
        </Card>
      ) : null}

      {data.roots.length === 0 ? (
        <Card>No telemetry yet. Run `clawhub sync` from the CLI.</Card>
      ) : (
        <div className="grid gap-4">
          {data.roots.map((root) => (
            <Card key={root.rootId} className="telemetry-root">
              <div className="telemetry-root-header">
                <div>
                  <div className="telemetry-root-title">{root.label}</div>
                  <div className="telemetry-root-meta">
                    Last sync {new Date(root.lastSeenAt).toLocaleString()}
                    {root.expiredAt ? " · stale" : ""}
                  </div>
                </div>
                <Badge>{root.skills.length} skills</Badge>
              </div>
              {root.skills.length === 0 ? (
                <div className="stat">No skills found in this root.</div>
              ) : (
                <div className="telemetry-skill-list">
                  {root.skills.map((entry) => (
                    <div key={`${root.rootId}:${entry.skill.slug}`} className="telemetry-skill-row">
                      <a
                        className="telemetry-skill-link"
                        href={`/${encodeURIComponent(entry.skill.ownerUserId)}/${entry.skill.slug}`}
                      >
                        <span>{entry.skill.displayName}</span>
                        <span className="telemetry-skill-slug">/{entry.skill.slug}</span>
                      </a>
                      <div className="telemetry-skill-meta mono">
                        {entry.lastVersion ? `v${entry.lastVersion}` : "v?"}{" "}
                        {entry.removedAt ? "· removed" : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

type TelemetryResponse = {
  roots: Array<{
    rootId: string;
    label: string;
    firstSeenAt: number;
    lastSeenAt: number;
    expiredAt?: number;
    skills: Array<{
      skill: {
        slug: string;
        displayName: string;
        summary?: string;
        stats: unknown;
        ownerUserId: string;
      };
      firstSeenAt: number;
      lastSeenAt: number;
      lastVersion?: string;
      removedAt?: number;
    }>;
  }>;
  cutoffDays: number;
};
