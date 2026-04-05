import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Building2, Users } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import { SkillCardSkeletonGrid } from "../../components/skeletons/SkillCardSkeleton";
import { SkillCard } from "../../components/SkillCard";
import { SkillStatsTripletLine } from "../../components/SkillStats";
import { Avatar, AvatarFallback, AvatarImage } from "../../components/ui/avatar";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { getSkillBadges } from "../../lib/badges";
import type { PublicPublisher, PublicSkill } from "../../lib/publicUser";

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
      <main className="py-10">
        <Container size="narrow">
          <div className="flex flex-col gap-6">
            <Card>
              <CardContent className="flex items-center gap-4 pt-6">
                <Skeleton className="h-16 w-16 rounded-full" />
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </CardContent>
            </Card>
            <SkillCardSkeletonGrid count={3} />
          </div>
        </Container>
      </main>
    );
  }

  if (!publisher || publisher.kind !== "org") {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            icon={Building2}
            title="Organization not found"
            description="This organization doesn't exist or may have been removed."
            action={{ label: "Browse skills", href: "/skills" }}
          />
        </Container>
      </main>
    );
  }

  const roleColor: Record<string, string> = {
    owner: "accent",
    admin: "default",
    publisher: "compact",
  };

  return (
    <main className="py-10">
      <Container size="narrow">
        <div className="flex flex-col gap-8">
          {/* Org header */}
          <Card>
            <CardContent className="flex items-center gap-5 pt-6">
              <Avatar className="h-16 w-16 text-lg">
                <AvatarImage src={publisher.image ?? undefined} alt={publisher.displayName} />
                <AvatarFallback>{publisher.displayName.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-1">
                <h1 className="font-display text-xl font-bold text-[color:var(--ink)]">
                  {publisher.displayName}
                </h1>
                <span className="text-sm text-[color:var(--ink-soft)]">@{publisher.handle}</span>
                {publisher.bio ? (
                  <p className="mt-1 text-sm text-[color:var(--ink-soft)]">{publisher.bio}</p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Published skills */}
          <section className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Published</h2>
            {(skills ?? []).length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
                {(skills ?? []).map((skill) => (
                  <SkillCard
                    key={skill._id}
                    skill={skill}
                    href={`/${encodeURIComponent(publisher.handle)}/${encodeURIComponent(skill.slug)}`}
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
              <EmptyState
                title="No published skills yet"
                description="This organization hasn't published any skills."
              />
            )}
          </section>

          {/* Members */}
          <section className="flex flex-col gap-4">
            <h2 className="font-display text-lg font-bold text-[color:var(--ink)] flex items-center gap-2">
              <Users className="h-4 w-4" />
              Members
            </h2>
            {(members?.members ?? []).length > 0 ? (
              <div className="flex flex-col gap-3">
                {members?.members.map((entry) => (
                  <Card key={`${entry.user._id}:${entry.role}`}>
                    <CardContent className="flex items-center justify-between py-4">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarImage
                            src={entry.user.image ?? undefined}
                            alt={entry.user.displayName ?? entry.user.handle ?? "User"}
                          />
                          <AvatarFallback>
                            {(entry.user.displayName ?? entry.user.handle ?? "U")
                              .charAt(0)
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-[color:var(--ink)]">
                            {entry.user.displayName ?? entry.user.handle ?? "User"}
                          </span>
                          {entry.user.handle ? (
                            <Link
                              to="/u/$handle"
                              params={{ handle: entry.user.handle }}
                              className="text-xs text-[color:var(--accent)] hover:underline"
                            >
                              @{entry.user.handle}
                            </Link>
                          ) : null}
                        </div>
                      </div>
                      <Badge
                        variant={
                          (roleColor[entry.role] ?? "default") as "accent" | "default" | "compact"
                        }
                      >
                        {entry.role}
                      </Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No members listed"
                description="Member information is not available."
              />
            )}
          </section>
        </div>
      </Container>
    </main>
  );
}
