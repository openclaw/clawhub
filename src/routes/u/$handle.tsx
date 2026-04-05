import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Star, User } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { SkillCardSkeletonGrid } from "../../components/skeletons/SkillCardSkeleton";
import { SkillCard } from "../../components/SkillCard";
import { SkillStatsTripletLine } from "../../components/SkillStats";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { getSkillBadges } from "../../lib/badges";
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
      <main className="py-10">
        <Container size="narrow">
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </Container>
      </main>
    );
  }

  if (user === null) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            icon={User}
            title="User not found"
            description="This user doesn't exist or their account has been removed."
          />
        </Container>
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
    <main className="py-10">
      <Container size="narrow">
        <div className="flex flex-col gap-8">
          {/* Profile header */}
          <Card className="flex-row items-center gap-4 p-6">
            <Avatar className="h-16 w-16">
              {avatar && <AvatarImage src={avatar} alt={displayName} />}
              <AvatarFallback className="text-xl">{initial}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-display text-xl font-bold text-[color:var(--ink)]">
                {displayName}
              </h1>
              <p className="font-mono text-sm text-[color:var(--ink-soft)]">@{displayHandle}</p>
            </div>
          </Card>

          {/* Tabs */}
          {isSelf ? (
            <Tabs value={tab} onValueChange={(v) => setTab(v as "stars" | "installed")}>
              <TabsList>
                <TabsTrigger value="stars">Stars</TabsTrigger>
                <TabsTrigger value="installed">Installed</TabsTrigger>
              </TabsList>
              <TabsContent value="stars" className="mt-6">
                <PublishedAndStarred
                  published={published}
                  isLoadingPublished={isLoadingPublished}
                  skills={skills}
                  isLoadingSkills={isLoadingSkills}
                />
              </TabsContent>
              <TabsContent value="installed" className="mt-6">
                <InstalledSection
                  includeRemoved={includeRemoved}
                  onToggleRemoved={() => setIncludeRemoved((value) => !value)}
                  data={installed}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <PublishedAndStarred
              published={published}
              isLoadingPublished={isLoadingPublished}
              skills={skills}
              isLoadingSkills={isLoadingSkills}
            />
          )}
        </div>
      </Container>
    </main>
  );
}

function PublishedAndStarred({
  published,
  isLoadingPublished,
  skills,
  isLoadingSkills,
}: {
  published: PublicSkill[];
  isLoadingPublished: boolean;
  skills: PublicSkill[];
  isLoadingSkills: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      {/* Published */}
      <section>
        <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Published</h2>
        <p className="mt-1 mb-4 text-sm text-[color:var(--ink-soft)]">
          Skills published by this user.
        </p>
        {isLoadingPublished ? (
          <SkillCardSkeletonGrid count={3} />
        ) : published.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
            {published.map((skill) => (
              <SkillCard
                key={skill._id}
                skill={skill}
                badge={getSkillBadges(skill)}
                summaryFallback="Agent-ready skill pack."
                meta={
                  <span className="text-[0.8rem] text-[color:var(--ink-soft)]">
                    <SkillStatsTripletLine stats={skill.stats} />
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-[color:var(--ink-soft)]">No published skills yet.</p>
        )}
      </section>

      {/* Stars */}
      <section>
        <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Stars</h2>
        <p className="mt-1 mb-4 text-sm text-[color:var(--ink-soft)]">
          Skills this user has starred.
        </p>
        {isLoadingSkills ? (
          <SkillCardSkeletonGrid count={3} />
        ) : skills.length === 0 ? (
          <EmptyState icon={Star} title="No stars yet" />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
            {skills.map((skill) => (
              <SkillCard
                key={skill._id}
                skill={skill}
                badge={getSkillBadges(skill)}
                summaryFallback="Agent-ready skill pack."
                meta={
                  <span className="text-[0.8rem] text-[color:var(--ink-soft)]">
                    <SkillStatsTripletLine stats={skill.stats} />
                  </span>
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
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
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Installed</h2>
        <SkillCardSkeletonGrid count={3} />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Installed</h2>
        <EmptyState title="Sign in to view your installed skills" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Installed</h2>
      <p className="max-w-2xl text-sm text-[color:var(--ink-soft)]">
        Private view. Only you can see your folders/roots. Everyone else only sees aggregated
        install counts per skill.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={props.onToggleRemoved}>
          {props.includeRemoved ? "Hide removed" : "Show removed"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowRaw((value) => !value)}>
          {showRaw ? "Hide JSON" : "Show JSON"}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => {
            toast("Delete all telemetry data?", {
              action: {
                label: "Delete",
                onClick: () => void clearTelemetry(),
              },
            });
          }}
        >
          Delete telemetry
        </Button>
      </div>

      {showRaw ? (
        <Card className="mb-4">
          <pre className="font-mono text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(data, null, 2)}
          </pre>
        </Card>
      ) : null}

      {data.roots.length === 0 ? (
        <EmptyState
          title="No telemetry yet"
          description='Run "clawhub sync" from the CLI to start tracking.'
        />
      ) : (
        <div className="grid gap-4">
          {data.roots.map((root) => (
            <Card key={root.rootId}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-display text-sm font-bold text-[color:var(--ink)]">
                    {root.label}
                  </h3>
                  <p className="text-xs text-[color:var(--ink-soft)]">
                    Last sync {new Date(root.lastSeenAt).toLocaleString()}
                    {root.expiredAt ? " · stale" : ""}
                  </p>
                </div>
                <Badge variant="default">{root.skills.length} skills</Badge>
              </div>
              {root.skills.length === 0 ? (
                <p className="text-sm text-[color:var(--ink-soft)]">
                  No skills found in this root.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {root.skills.map((entry) => (
                    <a
                      key={`${root.rootId}:${entry.skill.slug}`}
                      className="flex items-center justify-between rounded-[var(--radius-sm)] px-3 py-2 text-sm no-underline transition-colors hover:bg-[color:var(--surface-muted)]"
                      href={`/${encodeURIComponent(String(entry.skill.ownerUserId))}/${entry.skill.slug}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-[color:var(--ink)]">
                          {entry.skill.displayName}
                        </span>
                        <span className="font-mono text-xs text-[color:var(--ink-soft)]">
                          /{entry.skill.slug}
                        </span>
                      </span>
                      <span className="font-mono text-xs text-[color:var(--ink-soft)]">
                        {entry.lastVersion ? `v${entry.lastVersion}` : "v?"}{" "}
                        {entry.removedAt ? "· removed" : ""}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
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
