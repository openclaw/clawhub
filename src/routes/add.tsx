import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  Braces,
  Download,
  FolderGit2,
  Layers,
  Package,
  Plus,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../convex/_generated/api";
import { Container } from "../components/layout/Container";
import {
  PublisherOwnerSelect,
  type PublisherOwnerMembership,
} from "../components/PublisherOwnerSelect";
import { SignInPrompt } from "../components/SignInPrompt";
import { Card, CardContent } from "../components/ui/card";
import type { AddKind, AddMethod } from "../lib/addRoutes";
import { useAuthStatus } from "../lib/useAuthStatus";

type PluginFamily = "code-plugin" | "bundle-plugin";

export const Route = createFileRoute("/add")({
  validateSearch: (search: Record<string, unknown>) => {
    const kind: AddKind = search.kind === "plugin" || search.type === "plugin" ? "plugin" : "skill";
    const method =
      search.method === "github" || search.method === "manual" || search.method === "upload"
        ? (search.method as AddMethod)
        : undefined;
    return {
      kind,
      ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
      method,
    };
  },
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
  const [pluginFamily, setPluginFamily] = useState<PluginFamily | null>(null);

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

  useEffect(() => {
    if (kind !== "plugin") {
      setPluginFamily(null);
    }
  }, [kind]);

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

        {kind === "plugin" && !pluginFamily ? (
          <div className="grid gap-3">
            <AddMethodCard
              icon={<Braces size={20} aria-hidden="true" />}
              title="Code plugin"
              description="Executable OpenClaw plugin with package.json and plugin manifest."
              action="Choose code plugin"
              onSelect={() => setPluginFamily("code-plugin")}
            />
            <AddMethodCard
              icon={<Layers size={20} aria-hidden="true" />}
              title="Bundle plugin"
              description="Packaged plugin bundle distributed as a .zip or .tgz archive."
              action="Choose bundle plugin"
              onSelect={() => setPluginFamily("bundle-plugin")}
            />
          </div>
        ) : (
          <div className="grid gap-3">
            {kind === "plugin" ? (
              <button
                type="button"
                className="mb-1 self-start text-xs font-semibold text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
                onClick={() => setPluginFamily(null)}
              >
                ← Change plugin type
              </button>
            ) : null}
            {kind === "skill" && hasGitSyncPublisher ? (
              <AddMethodCard
                icon={<FolderGit2 size={20} aria-hidden="true" />}
                title="Git sync"
                description="Keep a public GitHub skills repo connected and sync changes automatically."
                to="/settings"
                search={{ view: "githubSources", ownerHandle: ownerHandle || undefined }}
                action="Configure sync"
              />
            ) : null}
            {kind === "skill" ? (
              <AddMethodCard
                icon={<Download size={20} aria-hidden="true" />}
                title="Import from GitHub"
                description="Bring one or more skills over from a public repository, then review before publishing."
                to="/import"
                search={{ ownerHandle: ownerHandle || undefined }}
                action="Import skills"
              />
            ) : null}
            <AddMethodCard
              icon={<Upload size={20} aria-hidden="true" />}
              title="Upload files"
              description={
                kind === "skill"
                  ? "Upload a skill folder containing SKILL.md and publish it manually."
                  : pluginFamily === "bundle-plugin"
                    ? "Upload a plugin bundle (.zip or .tgz) and publish a release."
                    : "Upload a plugin folder and publish a release."
              }
              to={kind === "skill" ? "/skills/publish" : "/plugins/publish"}
              search={
                kind === "skill"
                  ? { updateSlug: undefined, ownerHandle: ownerHandle || undefined }
                  : {
                      ...emptyPluginPublishSearch,
                      ownerHandle: ownerHandle || undefined,
                      family: pluginFamily ?? undefined,
                    }
              }
              action={kind === "skill" ? "Upload skill" : "Upload plugin"}
            />
          </div>
        )}

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
  onSelect,
  search,
  title,
  to,
}: {
  action: string;
  description: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  search?: Record<string, unknown>;
  title: string;
  to?: string;
}) {
  const content = (
    <Card className="h-full cursor-pointer transition-colors group-hover:border-[color:var(--accent)]">
      <CardContent className="flex-col items-center gap-4 p-5 text-center">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--accent)]">
          {icon}
        </span>
        <div className="min-w-0 w-full">
          <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">{title}</h2>
          <p className="mx-auto mt-1 max-w-[32ch] text-balance text-sm leading-5 text-[color:var(--ink-soft)]">
            {description}
          </p>
        </div>
        <span className="inline-flex min-h-[34px] shrink-0 items-center justify-center gap-2 rounded-[var(--r-btn)] border border-[color:var(--border-ui)] bg-transparent px-3 py-1.5 text-xs font-semibold text-[color:var(--ink)] transition-colors group-hover:border-[color:var(--border-ui-hover)] group-hover:bg-[color:var(--surface)]">
          {action}
          <ArrowRight size={15} aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  );

  if (onSelect) {
    return (
      <button
        type="button"
        aria-label={`${title}. ${description}`}
        className="group block w-full rounded-[var(--radius-md)] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
        onClick={onSelect}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      to={to!}
      search={search as never}
      aria-label={`${title}. ${description}`}
      className="group block rounded-[var(--radius-md)] !no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
    >
      {content}
    </Link>
  );
}
