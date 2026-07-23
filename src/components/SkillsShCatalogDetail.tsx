import {
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  ShieldAlert,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import {
  buildSkillsShInstallCommands,
  isSkillsShCatalogInstallable,
  SKILLS_SH_TRUST_LABEL,
  skillsShRepositoryLabel,
  type SkillsShCatalogDetail,
  type SkillsShUpstreamCheck,
} from "../lib/skillsShCatalog";
import { timeAgo } from "../lib/timeAgo";
import { InstallCopyButton } from "./InstallCopyButton";
import { Container } from "./layout/Container";
import { MarkdownPreview } from "./MarkdownPreview";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge } from "./ui/badge";

const CHECK_PRESENTATION = {
  passed: { label: "Passed", Icon: CheckCircle2, className: "text-status-success-fg" },
  warning: { label: "Warning", Icon: TriangleAlert, className: "text-status-warning-fg" },
  failed: { label: "Failed", Icon: XCircle, className: "text-status-error-fg" },
  unavailable: { label: "Unavailable", Icon: CircleHelp, className: "text-ink-soft" },
} as const;

export function SkillsShCatalogDetailPage({ entry }: { entry: SkillsShCatalogDetail }) {
  const installCommands = buildSkillsShInstallCommands(entry.reference);
  const installable = isSkillsShCatalogInstallable(entry);
  return (
    <main className="py-10 sm:py-14">
      <Container size="narrow">
        <div className="flex flex-col gap-5 border-b border-[color:var(--oc-border-subtle)] pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="break-all font-mono text-xs text-[color:var(--oc-text-muted)]">
              {entry.reference}
            </p>
            <h1 className="mt-2 font-display text-3xl font-black leading-tight text-[color:var(--oc-text-primary)] sm:text-4xl">
              {entry.displayName}
            </h1>
            {entry.summary ? (
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:var(--oc-text-secondary)] sm:text-base">
                {entry.summary}
              </p>
            ) : null}
          </div>
          <Badge variant="warning" className="shrink-0 self-start">
            <ShieldAlert aria-hidden="true" size={15} />
            {SKILLS_SH_TRUST_LABEL}
          </Badge>
        </div>

        <Alert variant="warn" className="mt-7">
          <ShieldAlert aria-hidden="true" size={17} />
          <AlertDescription>
            This is an upstream skills.sh listing stored by ClawHub. ClawHub has not scanned or
            accepted this source.
          </AlertDescription>
        </Alert>

        <dl className="grid grid-cols-1 gap-x-8 gap-y-6 py-7 sm:grid-cols-2">
          <DetailField label="Source" value={skillsShRepositoryLabel(entry)} mono />
          <DetailField label="Freshness" value={`Observed ${timeAgo(entry.lastObservedAt)}`} />
          {entry.githubPath ? <DetailField label="Path" value={entry.githubPath} mono /> : null}
          {entry.githubCommit ? (
            <DetailField label="Commit" value={entry.githubCommit} mono />
          ) : null}
        </dl>

        <div className="flex flex-wrap gap-3 border-b border-[color:var(--oc-border-subtle)] pb-7">
          <a
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--oc-accent-primary)] hover:underline"
            href={entry.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on skills.sh
            <ExternalLink aria-hidden="true" size={14} />
          </a>
          {entry.canonicalRepoUrl ? (
            <a
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--oc-text-secondary)] hover:text-[color:var(--oc-text-primary)] hover:underline"
              href={entry.canonicalRepoUrl}
              target="_blank"
              rel="noreferrer"
            >
              View repository
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          ) : null}
        </div>

        <section className="border-b border-[color:var(--oc-border-subtle)] py-7">
          <h2 className="font-display text-lg font-bold text-[color:var(--oc-text-primary)]">
            Install
          </h2>
          {installable ? (
            <div className="mt-3 grid gap-3">
              {installCommands.map(({ client, command }) => (
                <div key={client}>
                  <p className="mb-1 text-xs font-semibold text-[color:var(--oc-text-muted)]">
                    {client}
                  </p>
                  <div className="flex min-w-0 items-center gap-2 rounded-[var(--oc-radius-inset)] border border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-surface)] p-2 pl-3">
                    <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm text-[color:var(--oc-text-primary)]">
                      {command}
                    </code>
                    <InstallCopyButton
                      text={command}
                      ariaLabel={`Copy ${client} install command`}
                      showLabel={false}
                      variant="ghost"
                      size="icon-sm"
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Alert variant="warn" className="mt-3">
              <ShieldAlert aria-hidden="true" size={17} />
              <AlertDescription>
                This snapshot does not include a commit-pinned GitHub folder, so it cannot be
                installed yet.
              </AlertDescription>
            </Alert>
          )}
        </section>

        <section className="border-b border-[color:var(--oc-border-subtle)] py-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-[color:var(--oc-text-primary)]">
              Upstream checks
            </h2>
            <p className="text-xs text-[color:var(--oc-text-muted)]">
              Upstream checks are separate from ClawHub scanning.
            </p>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {entry.upstreamChecks.map((check) => (
              <UpstreamCheck key={check.scanner} check={check} />
            ))}
          </div>
        </section>

        {entry.content ? (
          <section className="pt-7">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-[color:var(--oc-text-primary)]">
                Stored {entry.content.kind === "skill-md" ? "SKILL.md" : "README"}
              </h2>
              <code className="break-all text-xs text-[color:var(--oc-text-muted)]">
                {entry.content.path}
              </code>
            </div>
            {entry.content.truncated ? (
              <p className="mt-2 text-xs text-[color:var(--oc-text-muted)]">
                Content is truncated to the stored 64 KiB snapshot.
              </p>
            ) : null}
            <MarkdownPreview className="mt-5">{entry.content.markdown}</MarkdownPreview>
          </section>
        ) : null}
      </Container>
    </main>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-[color:var(--oc-text-muted)]">{label}</dt>
      <dd
        className={`mt-1 break-all text-sm text-[color:var(--oc-text-primary)]${
          mono ? " font-mono" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function UpstreamCheck({ check }: { check: SkillsShUpstreamCheck }) {
  const presentation = CHECK_PRESENTATION[check.status];
  const { Icon } = presentation;
  return (
    <div className="rounded-[var(--oc-radius-inset)] border border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-surface)] px-3 py-3">
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" size={15} className={presentation.className} />
        <span className="text-sm font-semibold text-[color:var(--oc-text-primary)]">
          {check.scanner}
        </span>
      </div>
      <p className={`mt-1 text-xs font-medium ${presentation.className}`}>
        {check.sourceStatus === "unavailable" ? presentation.label : check.sourceStatus}
      </p>
      {check.checkedAt ? (
        <p className="mt-1 text-xs text-[color:var(--oc-text-muted)]">
          Checked {timeAgo(check.checkedAt)}
        </p>
      ) : null}
      {check.url ? (
        <a
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--oc-accent-primary)] hover:underline"
          href={check.url}
          target="_blank"
          rel="noreferrer"
        >
          View result
          <ExternalLink aria-hidden="true" size={12} />
        </a>
      ) : null}
    </div>
  );
}
