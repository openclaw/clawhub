import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { Container } from "../components/layout/Container";
import { SignInButton } from "../components/SignInButton";
import { Button } from "../components/ui/button";
import { formatCompactStat } from "../lib/numberFormat";
import type { PublicSkill } from "../lib/publicUser";

export const Route = createFileRoute("/stars")({
  component: Stars,
});

function Stars() {
  const me = useQuery(api.users.me) as Doc<"users"> | null | undefined;
  const skills =
    (useQuery(api.stars.listByUser, me ? { userId: me._id, limit: 50 } : "skip") as
      | PublicSkill[]
      | undefined) ?? [];

  const toggleStar = useMutation(api.stars.toggle);

  if (!me) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            icon={Star}
            title="Sign in to see your highlights"
            description="Star skills for quick access later."
          >
            <SignInButton variant="outline">Sign in with GitHub</SignInButton>
          </EmptyState>
        </Container>
      </main>
    );
  }

  return (
    <main className="py-10">
      <Container size="narrow">
        <div className="flex flex-col gap-6">
          <header>
            <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
              Your highlights
            </h1>
            <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
              Skills you've starred for quick access.
            </p>
          </header>
          {skills.length === 0 ? (
            <EmptyState
              icon={Star}
              title="No stars yet"
              description="Browse skills and star your favorites."
              action={{ label: "Browse skills", href: "/skills" }}
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
              {skills.map((skill) => {
                const owner = encodeURIComponent(String(skill.ownerUserId));
                return (
                  <div
                    key={skill._id}
                    className="flex w-full flex-col gap-3 rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] p-[22px] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(29,26,23,0.12)]"
                  >
                    <Link
                      to="/$owner/$slug"
                      params={{ owner, slug: skill.slug }}
                      className="no-underline"
                    >
                      <h3 className="font-display text-base font-bold text-[color:var(--ink)] hover:text-[color:var(--accent)]">
                        {skill.displayName}
                      </h3>
                    </Link>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-[color:var(--ink-soft)]">
                        <Star className="mr-1 inline h-3.5 w-3.5" />
                        {formatCompactStat(skill.stats.stars)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try {
                            await toggleStar({ skillId: skill._id });
                          } catch (error) {
                            console.error("Failed to unstar skill:", error);
                            toast.error("Unable to unstar this skill. Please try again.");
                          }
                        }}
                        aria-label={`Unstar ${skill.displayName}`}
                        className="text-[color:var(--gold)]"
                      >
                        <span aria-hidden="true">★</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Container>
    </main>
  );
}
