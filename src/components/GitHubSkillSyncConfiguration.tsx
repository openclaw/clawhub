import { AlertTriangle, Check, GitBranch } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type GitHubSkillSyncPublisherOption = {
  publisher: {
    _id: Id<"publishers">;
    handle: string;
  };
};

export type GitHubSkillSyncRepository = {
  repositoryId: string;
  repo: string;
  ownerId: string;
  ownerLogin: string;
  defaultBranch: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  pushedAt: string | null;
  selectable: boolean;
  unavailableReason: "disabled" | null;
};

type GitHubSkillSyncPreviewItem = {
  slug: string;
  displayName: string;
  path: string;
  contentHash: string;
  classification: "new-destination" | "replacement" | "unavailable" | "ownership-conflict";
  eligible: boolean;
  reason?: string;
  destination: {
    skillId: Id<"skills">;
    ownerPublisherId: Id<"publishers">;
    ownerHandle: string;
    slug: string;
    displayName: string;
  } | null;
};

export type GitHubSkillSyncPreview = {
  publisher: {
    _id: Id<"publishers">;
    handle: string;
    kind: "user" | "org";
  };
  repository: {
    requestedRepo: string;
    repositoryId: string;
    repo: string;
    redirected: boolean;
    defaultBranch: string;
    commit: string;
  };
  summary: {
    total: number;
    newDestinations: number;
    replacements: number;
    unavailable: number;
    conflicts: number;
  };
  items: GitHubSkillSyncPreviewItem[];
};

export function GitHubSkillSyncConfiguration({
  publisherOptions,
  selectedPublisherId,
  onPublisherChange,
  repositories,
  repositoriesError,
  isLoadingRepositories,
  githubRepo,
  onGithubRepoChange,
  onPreview,
  isPreviewing,
  preview,
}: {
  publisherOptions: GitHubSkillSyncPublisherOption[];
  selectedPublisherId: string;
  onPublisherChange: (publisherId: string) => void;
  repositories: GitHubSkillSyncRepository[];
  repositoriesError: string | null;
  isLoadingRepositories: boolean;
  githubRepo: string;
  onGithubRepoChange: (repo: string) => void;
  onPreview: (event: FormEvent) => void;
  isPreviewing: boolean;
  preview: GitHubSkillSyncPreview | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <form className="flex flex-col gap-4" onSubmit={onPreview}>
        <Field label="Publisher" htmlFor="settings-github-source-publisher">
          <Select value={selectedPublisherId} onValueChange={onPublisherChange}>
            <SelectTrigger id="settings-github-source-publisher">
              <SelectValue placeholder="Select publisher" />
            </SelectTrigger>
            <SelectContent>
              {publisherOptions.map((entry) => (
                <SelectItem key={entry.publisher._id} value={entry.publisher._id}>
                  @{entry.publisher.handle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="flex flex-col gap-2">
          <Label>Verified repositories</Label>
          {isLoadingRepositories ? (
            <p className="text-sm text-[color:var(--ink-soft)]">Loading repositories...</p>
          ) : repositories.length ? (
            <div className="divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
              {repositories.map((repository) => {
                const selected = githubRepo.toLowerCase() === repository.repo.toLowerCase();
                return (
                  <button
                    key={repository.repositoryId}
                    type="button"
                    aria-label={`Select ${repository.repo}`}
                    disabled={!repository.selectable}
                    onClick={() => onGithubRepoChange(repository.repo)}
                    className={`flex min-h-12 w-full min-w-0 items-center justify-between gap-3 px-1 py-3 text-left ${
                      selected
                        ? "text-[color:var(--ink)]"
                        : "text-[color:var(--ink-soft)] hover:text-[color:var(--ink)]"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <GitBranch size={16} className="shrink-0" />
                      <span className="truncate text-sm font-semibold">{repository.repo}</span>
                    </span>
                    {selected ? (
                      <Check size={16} className="shrink-0 text-[color:var(--accent)]" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[color:var(--ink-soft)]">
              No public repositories were returned for this publisher.
            </p>
          )}
          {repositoriesError ? (
            <p className="text-sm font-medium text-status-error-fg" role="alert">
              {repositoriesError}
            </p>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Field label="Repository URL" htmlFor="settings-github-repo">
              <Input
                id="settings-github-repo"
                value={githubRepo}
                onChange={(event) => onGithubRepoChange(event.target.value)}
                placeholder="https://github.com/owner/repo"
              />
            </Field>
          </div>
          <Button type="submit" disabled={!githubRepo.trim() || isPreviewing} className="shrink-0">
            <GitBranch size={16} />
            {isPreviewing ? "Previewing..." : "Preview repository"}
          </Button>
        </div>
      </form>

      {preview ? <GitHubSkillSyncRepositoryPreview preview={preview} /> : null}
    </div>
  );
}

function GitHubSkillSyncRepositoryPreview({ preview }: { preview: GitHubSkillSyncPreview }) {
  return (
    <section
      className="flex flex-col gap-4 border-t border-[color:var(--line)] pt-5"
      aria-labelledby="github-skill-sync-preview-title"
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h4
            id="github-skill-sync-preview-title"
            className="text-sm font-bold text-[color:var(--ink)]"
          >
            Repository preview
          </h4>
          <p className="truncate text-sm text-[color:var(--ink-soft)]">
            {preview.repository.repo} at {preview.repository.commit.slice(0, 7)}
          </p>
        </div>
        <span className="text-xs font-semibold text-[color:var(--ink-soft)]">
          {preview.summary.total} {preview.summary.total === 1 ? "skill" : "skills"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-5 gap-y-3 border-y border-[color:var(--line)] py-3 sm:grid-cols-4">
        <SummaryCount label="New" value={preview.summary.newDestinations} />
        <SummaryCount label="Replacements" value={preview.summary.replacements} />
        <SummaryCount label="Unavailable" value={preview.summary.unavailable} />
        <SummaryCount label="Conflicts" value={preview.summary.conflicts} />
      </div>

      {preview.summary.replacements > 0 ? (
        <div className="flex items-start gap-3 border-l-2 border-status-warning-fg bg-status-warning-bg px-3 py-3">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-status-warning-fg" />
          <p className="text-sm leading-6 text-[color:var(--ink)]">
            Matching Hosted Skills switch to GitHub Skill Sync only after their exact candidates
            pass ClawHub scanning.
          </p>
        </div>
      ) : null}

      <div className="divide-y divide-[color:var(--line)] border-y border-[color:var(--line)]">
        {preview.items.map((item) => (
          <div
            key={`${item.path}:${item.contentHash}`}
            className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[color:var(--ink)]">
                {item.displayName}
              </p>
              <p className="truncate text-xs font-mono text-[color:var(--ink-soft)]">{item.path}</p>
            </div>
            <span
              className={`shrink-0 text-xs font-semibold ${classificationTone(
                item.classification,
              )}`}
            >
              {classificationLabel(item.classification)}
            </span>
            {item.reason ? (
              <p className="text-xs leading-5 text-[color:var(--ink-soft)] sm:max-w-72 sm:text-right">
                {previewReasonLabel(item.reason)}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          disabled
          title="Activation waits for the canonical GitHub Skill Sync engine."
        >
          Enable GitHub Skill Sync
        </Button>
      </div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <div className="text-lg font-bold text-[color:var(--ink)]">{value}</div>
      <div className="text-xs font-semibold text-[color:var(--ink-soft)]">{label}</div>
    </div>
  );
}

function classificationLabel(classification: GitHubSkillSyncPreviewItem["classification"]) {
  switch (classification) {
    case "new-destination":
      return "New destination";
    case "replacement":
      return "Hosted Skill replacement";
    case "unavailable":
      return "Unavailable";
    case "ownership-conflict":
      return "Ownership conflict";
  }
  return assertNever(classification);
}

function classificationTone(classification: GitHubSkillSyncPreviewItem["classification"]) {
  switch (classification) {
    case "new-destination":
      return "text-status-success-fg";
    case "replacement":
      return "text-status-warning-fg";
    case "unavailable":
    case "ownership-conflict":
      return "text-status-error-fg";
  }
  return assertNever(classification);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported GitHub Skill Sync classification: ${String(value)}`);
}

function previewReasonLabel(reason: string) {
  switch (reason) {
    case "invalid-skill-slug":
      return "The discovered skill slug is not valid.";
    case "destination-soft-deleted":
      return "A deleted destination already uses this slug.";
    case "already-synced":
      return "This skill is already synchronized from this repository.";
    case "destination-uses-another-github-source":
      return "This destination is connected to another GitHub repository.";
    case "destination-alias-conflict":
      return "This slug is reserved by an existing publisher alias.";
    case "repository-owned-by-another-publisher":
      return "This repository is already connected to another publisher.";
    default:
      return "This skill is not eligible for GitHub Skill Sync.";
  }
}
