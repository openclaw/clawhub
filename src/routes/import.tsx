import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAction, useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import { EmptyState } from "../components/EmptyState";
import { Container } from "../components/layout/Container";
import { SignInButton } from "../components/SignInButton";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { getUserFacingConvexError } from "../lib/convexError";
import { getPublicSlugCollision } from "../lib/slugCollision";
import { formatBytes } from "../lib/uploadUtils";
import { useAuthStatus } from "../lib/useAuthStatus";

export const Route = createFileRoute("/import")({
  component: ImportGitHub,
});

type Candidate = {
  path: string;
  readmePath: string;
  name: string | null;
  description: string | null;
};

type CandidatePreview = {
  resolved: {
    owner: string;
    repo: string;
    ref: string;
    commit: string;
    path: string;
    repoUrl: string;
    originalUrl: string;
  };
  candidate: Candidate;
  defaults: {
    selectedPaths: string[];
    slug: string;
    displayName: string;
    version: string;
    tags: string[];
  };
  files: Array<{ path: string; size: number; defaultSelected: boolean }>;
};

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function ImportGitHub() {
  const { isAuthenticated, isLoading, me } = useAuthStatus();
  const previewImport = useAction(api.githubImport.previewGitHubImport);
  const previewCandidate = useAction(api.githubImport.previewGitHubImportCandidate);
  const importSkill = useAction(api.githubImport.importGitHubSkill);
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidatePath, setSelectedCandidatePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<CandidatePreview | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [version, setVersion] = useState("0.1.0");
  const [tags, setTags] = useState("latest");

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const trimmedSlug = slug.trim();
  const slugAvailability = useQuery(
    api.skills.checkSlugAvailability,
    isAuthenticated && trimmedSlug && SLUG_PATTERN.test(trimmedSlug)
      ? { slug: trimmedSlug.toLowerCase() }
      : "skip",
  ) as
    | {
        available: boolean;
        reason: "available" | "taken" | "reserved";
        message: string | null;
        url: string | null;
      }
    | null
    | undefined;
  const slugCollision = useMemo(
    () =>
      getPublicSlugCollision({
        isSoulMode: false,
        slug: trimmedSlug,
        result: slugAvailability,
      }),
    [slugAvailability, trimmedSlug],
  );

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);
  const selectedBytes = useMemo(() => {
    if (!preview) return 0;
    let total = 0;
    for (const file of preview.files) {
      if (selected[file.path]) total += file.size;
    }
    return total;
  }, [preview, selected]);

  const detect = async () => {
    setError(null);
    setStatus(null);
    setPreview(null);
    setCandidates([]);
    setSelectedCandidatePath(null);
    setSelected({});
    setIsBusy(true);
    try {
      const result = await previewImport({ url: url.trim() });
      const items = (result.candidates ?? []) as Candidate[];
      setCandidates(items);
      if (items.length === 1) {
        const only = items[0];
        if (only) await loadCandidate(only.path);
      } else {
        setStatus(`Found ${items.length} skills. Pick one.`);
      }
    } catch (e) {
      setError(getUserFacingConvexError(e, "Preview failed"));
    } finally {
      setIsBusy(false);
    }
  };

  const loadCandidate = async (candidatePath: string) => {
    setError(null);
    setStatus(null);
    setPreview(null);
    setSelected({});
    setSelectedCandidatePath(candidatePath);
    setIsBusy(true);
    try {
      const result = (await previewCandidate({
        url: url.trim(),
        candidatePath,
      })) as CandidatePreview;
      setPreview(result);
      setSlug(result.defaults.slug);
      setDisplayName(result.defaults.displayName);
      setVersion(result.defaults.version);
      setTags((result.defaults.tags ?? ["latest"]).join(","));
      const nextSelected: Record<string, boolean> = {};
      for (const file of result.files) nextSelected[file.path] = file.defaultSelected;
      setSelected(nextSelected);
      setStatus("Ready to import.");
    } catch (e) {
      setError(getUserFacingConvexError(e, "Preview failed"));
    } finally {
      setIsBusy(false);
    }
  };

  const applyDefaultSelection = () => {
    if (!preview) return;
    const set = new Set(preview.defaults.selectedPaths);
    const next: Record<string, boolean> = {};
    for (const file of preview.files) next[file.path] = set.has(file.path);
    setSelected(next);
  };

  const selectAll = () => {
    if (!preview) return;
    const next: Record<string, boolean> = {};
    for (const file of preview.files) next[file.path] = true;
    setSelected(next);
  };

  const clearAll = () => {
    if (!preview) return;
    const next: Record<string, boolean> = {};
    for (const file of preview.files) next[file.path] = false;
    setSelected(next);
  };

  const doImport = async () => {
    if (!preview) return;
    if (slugCollision) {
      toast.error(slugCollision.message);
      return;
    }
    setIsBusy(true);
    setError(null);
    setStatus("Importing...");
    try {
      const selectedPaths = preview.files.map((file) => file.path).filter((path) => selected[path]);
      const tagList = tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const result = await importSkill({
        url: url.trim(),
        commit: preview.resolved.commit,
        candidatePath: preview.candidate.path,
        selectedPaths,
        slug: slug.trim(),
        displayName: displayName.trim(),
        version: version.trim(),
        tags: tagList,
      });
      const nextSlug = result.slug;
      setStatus("Imported.");
      const ownerParam = me?.handle ?? (me?._id ? String(me._id) : "unknown");
      await navigate({ to: "/$owner/$slug", params: { owner: ownerParam, slug: nextSlug } });
    } catch (e) {
      toast.error(getUserFacingConvexError(e, "Import failed"));
      setStatus(null);
    } finally {
      setIsBusy(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            title={isLoading ? "Loading..." : "Sign in to import and publish skills"}
            description="You need to be signed in to import skills from GitHub."
          >
            {!isLoading ? (
              <SignInButton variant="outline">Sign in with GitHub</SignInButton>
            ) : null}
          </EmptyState>
        </Container>
      </main>
    );
  }

  return (
    <main className="py-10">
      <Container>
        <header className="mb-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[color:var(--accent)]">
                GitHub import
              </p>
              <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
                Import from GitHub
              </h1>
              <p className="text-sm text-[color:var(--ink-soft)]">
                Public repos only. Detects SKILL.md automatically.
              </p>
              <Badge variant="accent" className="mt-3 w-fit">
                Skill-only import. Plugins are not supported here. Use{" "}
                <Link
                  to="/publish-plugin"
                  search={{
                    ownerHandle: undefined,
                    name: undefined,
                    displayName: undefined,
                    family: undefined,
                    nextVersion: undefined,
                    sourceRepo: undefined,
                  }}
                  className="underline"
                >
                  Publish Plugin
                </Link>
                .
              </Badge>
            </div>
            <div className="flex flex-col items-end gap-1 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm">
              <div className="font-semibold">Public only</div>
              <div className="text-xs text-[color:var(--ink-soft)]">Commit pinned</div>
            </div>
          </div>
        </header>

        <Card className="mb-5">
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="github-url">GitHub URL</Label>
                <span className="text-xs text-[color:var(--ink-soft)]">
                  Repo, tree path, or blob
                </span>
              </div>
              <Input
                id="github-url"
                className="mt-1"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              disabled={!url.trim() || isBusy}
              onClick={() => void detect()}
            >
              Detect
            </Button>
            {status ? <p className="text-sm text-[color:var(--ink-soft)]">{status}</p> : null}
          </div>

          {error ? (
            <div className="mt-3 rounded-[var(--radius-sm)] border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          ) : null}
        </Card>

        {candidates.length > 1 ? (
          <Card className="mb-5">
            <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Pick a skill</h2>
            <div className="flex flex-col gap-2">
              {candidates.map((candidate) => (
                <label
                  key={candidate.path}
                  className="flex items-center gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] px-3 py-2 cursor-pointer hover:bg-[color:var(--surface-muted)]"
                >
                  <input
                    type="radio"
                    name="candidate"
                    checked={selectedCandidatePath === candidate.path}
                    onChange={() => void loadCandidate(candidate.path)}
                    disabled={isBusy}
                  />
                  <span className="font-mono text-xs">{candidate.path || "(repo root)"}</span>
                  <span className="text-sm text-[color:var(--ink-soft)]">
                    {candidate.name
                      ? candidate.name
                      : candidate.description
                        ? candidate.description
                        : ""}
                  </span>
                </label>
              ))}
            </div>
          </Card>
        ) : null}

        {preview ? (
          <>
            <Card className="mb-5">
              <div className="grid gap-5 md:grid-cols-[1fr_auto]">
                <div className="flex flex-col gap-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="slug">Slug</Label>
                      <span className="text-xs text-[color:var(--ink-soft)]">
                        Unique, lowercase
                      </span>
                    </div>
                    <Input
                      id="slug"
                      className="mt-1"
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="name">Display name</Label>
                      <span className="text-xs text-[color:var(--ink-soft)]">
                        Shown in listings
                      </span>
                    </div>
                    <Input
                      id="name"
                      className="mt-1"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="version">Version</Label>
                        <span className="text-xs text-[color:var(--ink-soft)]">Semver</span>
                      </div>
                      <Input
                        id="version"
                        className="mt-1"
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label htmlFor="tags">Tags</Label>
                        <span className="text-xs text-[color:var(--ink-soft)]">
                          Comma-separated
                        </span>
                      </div>
                      <Input
                        id="tags"
                        className="mt-1"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                </div>
                <aside className="flex flex-col gap-1 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-600">
                    Commit pinned
                  </div>
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    {preview.resolved.owner}/{preview.resolved.repo}@
                    {preview.resolved.commit.slice(0, 7)}
                  </div>
                  <div className="font-mono text-xs text-[color:var(--ink-soft)]">
                    {preview.candidate.path || "repo root"}
                  </div>
                </aside>
              </div>
            </Card>

            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-bold text-[color:var(--ink)]">Files</h2>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={applyDefaultSelection}
                  >
                    Select referenced
                  </Button>
                  <Button variant="outline" size="sm" disabled={isBusy} onClick={selectAll}>
                    Select all
                  </Button>
                  <Button variant="outline" size="sm" disabled={isBusy} onClick={clearAll}>
                    Clear
                  </Button>
                </div>
              </div>
              <p className="text-sm text-[color:var(--ink-soft)]">
                Selected: {selectedCount}/{preview.files.length} &bull; {formatBytes(selectedBytes)}
              </p>
              <div className="flex flex-col gap-1">
                {preview.files.map((file) => (
                  <label
                    key={file.path}
                    className="flex items-center gap-3 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-[color:var(--surface-muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(selected[file.path])}
                      onChange={() =>
                        setSelected((prev) => ({ ...prev, [file.path]: !prev[file.path] }))
                      }
                      disabled={isBusy}
                    />
                    <span className="flex-1 truncate font-mono text-xs">{file.path}</span>
                    <span className="shrink-0 text-xs text-[color:var(--ink-soft)]">
                      {formatBytes(file.size)}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button
                  variant="primary"
                  disabled={
                    isBusy ||
                    !slug.trim() ||
                    !displayName.trim() ||
                    !version.trim() ||
                    selectedCount === 0 ||
                    Boolean(slugCollision)
                  }
                  onClick={() => void doImport()}
                >
                  Import + publish
                </Button>
                {slugCollision ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    {slugCollision.message}
                    {slugCollision.url ? (
                      <>
                        {" "}
                        <a
                          href={slugCollision.url}
                          className="text-[color:var(--accent)] hover:underline"
                        >
                          {slugCollision.url}
                        </a>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Card>
          </>
        ) : null}
      </Container>
    </main>
  );
}
