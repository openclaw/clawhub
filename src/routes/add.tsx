import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowRight, Download, FolderGit2, Package, Plus, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Container } from "../components/layout/Container";
import {
  PublisherOwnerSelect,
  type PublisherOwnerMembership,
} from "../components/PublisherOwnerSelect";
import { SignInPrompt } from "../components/SignInPrompt";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { useAuthStatus } from "../lib/useAuthStatus";

type AddKind = "skill" | "plugin";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => ({
    kind: search.kind === "plugin" ? ("plugin" as const) : ("skill" as const),
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  }),
  component: AddPage,
});

const emptyPluginPublishSearch = {
  ownerHandle: undefined,
  name: undefined,
  displayName: undefined,
  family: undefined,
  nextVersion: undefined,
  sourceRepo: undefined,
} as const;

export function AddPage() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const search = Route.useSearch();
  const memberships = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | PublisherOwnerMembership[]
    | undefined;
  const [kind, setKind] = useState<AddKind>(search.kind);
  const [ownerHandle, setOwnerHandle] = useState(search.ownerHandle ?? "");

  const selectedMembership = useMemo(
    () => memberships?.find((entry) => entry.publisher.handle === ownerHandle) ?? null,
    [memberships, ownerHandle],
  );
  const orgMemberships = useMemo(
    () =>
      (memberships ?? []).filter(
        (entry) => entry.publisher.kind === "org" && entry.publisher.official === true,
      ),
    [memberships],
  );
  const hasGitSyncPublisher = orgMemberships.length > 0;

  useEffect(() => {
    if (ownerHandle || !memberships?.length) return;
    const personal = memberships.find((entry) => entry.publisher.kind === "user");
    setOwnerHandle((personal ?? memberships[0]).publisher.handle);
  }, [memberships, ownerHandle]);

  useEffect(() => {
    setKind(search.kind);
  }, [search.kind]);

  if (isLoading) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <div className="h-64 animate-pulse rounded-[var(--radius-md)] bg-[color:var(--surface-muted)]" />
        </Container>
      </main>
    );
  }

  if (!isAuthenticated || !me) {
    return <SignInPrompt title="Sign in to add a skill or plugin." />;
  }

  return (
    <main className="py-10">
      <Container size="narrow">
        <header className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-[color:var(--accent)]">
            Publish
          </p>
          <h1 className="font-display text-3xl font-black text-[color:var(--ink)]">
            Add a skill or plugin
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--ink-soft)]">
            Choose what you are adding, then pick the source that matches how you maintain it.
          </p>
        </header>

        <div className="mb-6 flex flex-col gap-3">
          <label htmlFor="add-owner" className="text-sm font-semibold text-[color:var(--ink)]">
            Add as
          </label>
          <PublisherOwnerSelect
            id="add-owner"
            value={ownerHandle}
            memberships={memberships}
            onValueChange={setOwnerHandle}
          />
          {selectedMembership?.publisher.kind === "org" ? (
            <p className="text-xs text-[color:var(--ink-soft)]">
              This will publish into @{selectedMembership.publisher.handle}.
            </p>
          ) : null}
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)]/40 p-1">
          <button
            type="button"
            className={`flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm font-semibold transition-colors ${
              kind === "skill"
                ? "bg-[color:var(--surface)] text-[color:var(--ink)] shadow-sm"
                : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
            }`}
            aria-pressed={kind === "skill"}
            onClick={() => setKind("skill")}
          >
            <Plus size={16} aria-hidden="true" />
            Skill
          </button>
          <button
            type="button"
            className={`flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-sm)] px-3 text-sm font-semibold transition-colors ${
              kind === "plugin"
                ? "bg-[color:var(--surface)] text-[color:var(--ink)] shadow-sm"
                : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
            }`}
            aria-pressed={kind === "plugin"}
            onClick={() => setKind("plugin")}
          >
            <Package size={16} aria-hidden="true" />
            Plugin
          </button>
        </div>

        <div className="grid gap-3">
          {kind === "skill" && hasGitSyncPublisher ? (
            <AddMethodCard
              icon={<FolderGit2 size={20} aria-hidden="true" />}
              title="Git sync"
              description="Keep a public GitHub skills repo connected and sync changes automatically."
              to="/settings"
              search={{ view: "githubSources" }}
              action="Configure sync"
            />
          ) : null}
          {kind === "skill" ? (
            <AddMethodCard
              icon={<Download size={20} aria-hidden="true" />}
              title="Import from GitHub"
              description="Bring one or more skills over from a public repository, then review before publishing."
              to="/import"
              action="Import skills"
            />
          ) : null}
          <AddMethodCard
            icon={<Upload size={20} aria-hidden="true" />}
            title="Upload files"
            description={
              kind === "skill"
                ? "Upload a skill folder containing SKILL.md and publish it manually."
                : "Upload a plugin folder, .zip, or .tgz and publish a release."
            }
            to={kind === "skill" ? "/skills/publish" : "/plugins/publish"}
            search={
              kind === "skill"
                ? { updateSlug: undefined, ownerHandle: ownerHandle || undefined }
                : { ...emptyPluginPublishSearch, ownerHandle: ownerHandle || undefined }
            }
            action={kind === "skill" ? "Upload skill" : "Upload plugin"}
          />
        </div>

        <p className="mt-6 text-center text-xs text-[color:var(--ink-soft)]">
          You can change the publisher later from the publish form.
        </p>
      </Container>
    </main>
  );
}

function AddMethodCard({
  action,
  description,
  icon,
  search,
  title,
  to,
}: {
  action: string;
  description: string;
  icon: React.ReactNode;
  search?: Record<string, unknown>;
  title: string;
  to: string;
}) {
  return (
    <Card className="transition-colors hover:border-[color:var(--accent)]">
      <CardContent className="flex items-center gap-4 p-5">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--accent)]">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-[color:var(--ink-soft)]">{description}</p>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0">
          <Link to={to} search={search as never}>
            {action}
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
