import { type } from "arktype";
import type { TemplateDependencyInventory, TemplateManifest } from "clawhub-schema";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Plug,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { sha256Hex } from "../../convex/lib/hash";
import { fetchPackageFile } from "../lib/packageApi";
import { buildPluginDetailHref } from "../lib/pluginRoutes";
import { publicApiUrl } from "../lib/publicApiUrl";
import type { TemplateWorkspaceContents } from "../lib/templateDetail";
import type { TemplateDisplayInventory } from "../lib/templateDisplayInventory";
import { MarkdownPreview } from "./MarkdownPreview";
import { stripFrontmatter } from "./skillDetailUtils";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./ui/dialog";

// Match the catalog's 2,048 character plain-text preview. Expansion uses the actual file.
function excerpt(markdown: string) {
  return markdown
    .replace(/\x60{3}[\s\S]*?\x60{3}/g, " ")
    .replace(/!?\[([^\]\n]*)\]\([^\s)]+\)/g, "$1")
    .replace(/^[\t ]{0,3}(?:(?:>[\t ]*)+|(?:#{1,6}|[-+*]|\d+[.)])\s+)/gm, "")
    .replace(/(\*\*|__|~~)(.+?)\1/g, "$2")
    .replace(/\x60([^\x60]+)\x60/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2048);
}

export function TemplatePersonality({ markdown }: { markdown: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = body.current;
    if (!element || expanded) return undefined;
    const measure = () => {
      const limit = Number.parseFloat(
        getComputedStyle(element).getPropertyValue("--template-readme-clamp"),
      );
      setClamped(element.scrollHeight > limit + 24);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, markdown]);
  return (
    <section className="template-catalog-personality" aria-label="Personality">
      <div className="template-catalog-label">
        <h2>Personality</h2>
        <Dialog>
          <DialogTrigger asChild>
            <button type="button" className="template-catalog-file">
              SOUL.md
            </button>
          </DialogTrigger>
          <DialogContent className="template-catalog-file-dialog" aria-describedby={undefined}>
            <DialogTitle>SOUL.md</DialogTitle>
            <MarkdownPreview className="template-catalog-document">{markdown}</MarkdownPreview>
          </DialogContent>
        </Dialog>
      </div>
      <div className="template-catalog-well">
        <div
          id={id}
          ref={body}
          className="template-catalog-well-body"
          data-clamped={!expanded && clamped}
        >
          {expanded ? (
            <MarkdownPreview className="template-catalog-document">{markdown}</MarkdownPreview>
          ) : (
            <p>{excerpt(markdown)}</p>
          )}
        </div>
        <button
          className="template-catalog-toggle"
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              Show less <ChevronUp />
            </>
          ) : (
            <>
              Show more <ChevronDown />
            </>
          )}
        </button>
      </div>
    </section>
  );
}

type PreviewSource =
  | { package: string; path: string; version: string }
  | { skill: string; version: string };
type Row = {
  key: string;
  name: string;
  description?: string;
  details: ReactNode;
  preview?: PreviewSource;
};

const verifiedSource = type({
  slug: "string",
  publisherHandle: "string",
  version: "string",
  resolvedFrom: "'version'",
  artifact: { files: type({ path: "string", sha256: "string" }).array() },
});

async function readSkillDocument(source: PreviewSource, signal: AbortSignal) {
  if ("package" in source) return fetchPackageFile(source.package, source.path, source.version);
  // Bare references lack a publisher pin. Never guess the Template's owner or use latest.
  const ref = /^@([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/.exec(source.skill);
  if (!ref || !source.version.trim()) return null;
  const [, owner, slug] = ref;
  const get = async (route: "verify" | "file") => {
    const url = publicApiUrl("/api/v1/skills/" + encodeURIComponent(slug) + "/" + route);
    url.searchParams.set("ownerHandle", owner);
    url.searchParams.set("version", source.version);
    if (route === "file") {
      url.searchParams.set("path", "SKILL.md");
      url.searchParams.set("preview", "1");
    }
    const response = await fetch(url, { signal, credentials: "omit" });
    if ([403, 404, 409, 410, 413, 415, 423].includes(response.status)) return null;
    if (!response.ok) throw new Error("Skill preview unavailable");
    return response;
  };
  // Scoped registry aliases can resolve across publishers after a merge. Check the
  // canonical release and its source-file digest, not the generated card or its status.
  const metadata = await get("verify");
  if (!metadata) return null;
  const verified = verifiedSource(await metadata.json());
  if (
    verified instanceof type.errors ||
    verified.publisherHandle !== owner ||
    verified.slug !== slug ||
    verified.version !== source.version
  )
    return null;
  const { files } = verified.artifact;
  const file =
    files.find((f) => f.path === "SKILL.md") ??
    files.find((f) => f.path.toLowerCase() === "skill.md");
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256)) return null;
  const response = await get("file");
  if (!response) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== file.sha256) return null;
  return new TextDecoder().decode(bytes);
}

function SkillDocument({ source }: { source: PreviewSource }) {
  const [read, setRead] = useState<{ contents?: string | null; failed?: boolean }>({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void readSkillDocument(source, controller.signal).then(
      (contents) => {
        if (!controller.signal.aborted) setRead({ contents });
      },
      () => {
        if (!controller.signal.aborted) setRead({ failed: true });
      },
    );
    return () => controller.abort();
  }, [source, attempt]);
  if (read.failed)
    return (
      <p role="alert">
        Could not load this skill.{" "}
        <button
          type="button"
          onClick={() => {
            setRead({});
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </p>
    );
  if (read.contents === undefined) return <p role="status">Loading skill…</p>;
  if (read.contents === null) return <p>Skill preview is unavailable for this release.</p>;
  return (
    <MarkdownPreview className="template-catalog-document">
      {stripFrontmatter(read.contents)}
    </MarkdownPreview>
  );
}

function CapabilitySection({
  label,
  icon: Icon,
  rows,
  dialog,
}: {
  label: string;
  icon: LucideIcon;
  rows: Row[];
  dialog?: "metadata" | "automation";
}) {
  if (!rows.length) return null;
  return (
    <section className="template-catalog-capabilities" aria-label={label}>
      <h2>{label}</h2>
      <div className="template-catalog-group">
        {rows.map((row) => {
          const rowContent = (
            <>
              <span className="template-catalog-row-icon">
                <Icon aria-hidden="true" />
              </span>
              <span className="template-catalog-row-text">
                <strong>{row.name}</strong>
                {row.description && <span>{row.description}</span>}
              </span>
              <ChevronRight className="template-catalog-chevron" aria-hidden="true" />
            </>
          );
          return row.preview || dialog ? (
            <Dialog key={row.key}>
              <DialogTrigger asChild>
                <button type="button" className="template-catalog-row">
                  {rowContent}
                </button>
              </DialogTrigger>
              {dialog === "automation" ? (
                <DialogContent
                  className="template-automation-dialog"
                  {...(!row.description && { "aria-describedby": undefined })}
                >
                  <header>
                    <span className="template-automation-dialog-icon">
                      <Icon aria-hidden="true" />
                    </span>
                    <div>
                      <DialogTitle>{row.name}</DialogTitle>
                      {row.description && <DialogDescription>{row.description}</DialogDescription>}
                    </div>
                  </header>
                  <div className="template-automation-dialog-body">{row.details}</div>
                </DialogContent>
              ) : (
                <DialogContent
                  className="template-catalog-file-dialog"
                  aria-describedby={undefined}
                >
                  <DialogTitle>{row.name}</DialogTitle>
                  {row.preview ? (
                    <SkillDocument source={row.preview} />
                  ) : (
                    <div className="template-catalog-plugin-info">{row.details}</div>
                  )}
                </DialogContent>
              )}
            </Dialog>
          ) : (
            <details key={row.key}>
              <summary className="template-catalog-row">{rowContent}</summary>
              <div className="template-catalog-row-details">{row.details}</div>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function scheduleLabel(expression: string) {
  // Ordinary daily/weekday schedules get words; retain other valid cron expressions verbatim.
  const fields = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5)$/.exec(expression);
  if (!fields || +fields[1] > 59 || +fields[2] > 23) return expression;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(2024, 0, 1, +fields[2], +fields[1]));
  return (fields[3] === "*" ? "Daily" : "Weekdays") + " at " + time;
}

/** Named release contents paint even while CLAW.md is loading. */
export function TemplateReleaseInventory({
  display,
  packageName,
  releaseVersion,
  manifest,
  dependencies,
  workspace,
  personality,
  documentLoading,
}: {
  display?: TemplateDisplayInventory;
  packageName: string;
  releaseVersion?: string | null;
  manifest: TemplateManifest | null;
  dependencies: TemplateDependencyInventory;
  workspace: TemplateWorkspaceContents | null;
  personality: ReactNode;
  documentLoading: boolean;
}) {
  const packages = (kind: "skill" | "plugin"): Row[] =>
    dependencies
      .filter((entry) => entry.kind === kind)
      .map((entry) => ({
        key: entry.source === "bundled" ? entry.path : entry.ref,
        name: entry.source === "bundled" ? entry.name || entry.path : entry.ref,
        preview:
          kind !== "skill"
            ? undefined
            : entry.source === "clawhub"
              ? { skill: entry.ref, version: entry.version }
              : releaseVersion
                ? { package: packageName, version: releaseVersion, path: entry.path + "/SKILL.md" }
                : undefined,
        details:
          entry.source === "bundled" ? (
            <>
              Bundled · <code>{entry.path}</code>
            </>
          ) : (
            <>
              {kind === "plugin" ? "Plugin" : "Skill"} · {entry.version}
              {kind === "plugin" && (
                <p>
                  <a href={buildPluginDetailHref(entry.ref)}>View plugin on ClawHub</a>
                </p>
              )}
            </>
          ),
      }));
  const workspaceRows = (kind: "skills" | "plugins"): Row[] =>
    (workspace?.[kind] ?? []).map((entry) => {
      const path =
        display?.contents.instructions.find((file) => file.name === entry.path)?.source ??
        manifest?.workspace?.files?.find((file) => file.path === entry.path)?.source;
      return {
        preview:
          kind === "skills" && path && releaseVersion
            ? { package: packageName, path, version: releaseVersion }
            : undefined,
        key: "workspace:" + entry.path,
        name: entry.name,
        details: (
          <>
            Workspace file · <code>{entry.path}</code>
          </>
        ),
      };
    });
  const mcp = display
    ? display.contents.integrations.filter((row) => row.kind === "mcpServer").map((row) => row.name)
    : Object.keys(manifest?.mcpServers ?? {});
  const jobs = display
    ? display.contents.automations
    : (manifest?.automations ?? []).map((job) => ({
        name: job.name || job.id,
        enabled: job.enabled !== false,
        schedule: job.schedule.cron,
        timezone: job.schedule.timezone,
      }));
  const automations: Row[] = jobs.map((job, index) => ({
    key: job.name + ":" + index,
    name: job.name,
    description: [
      scheduleLabel(job.schedule),
      job.timezone,
      job.enabled ? "Enabled" : "Disabled",
    ].join(" · "),
    details: documentLoading ? (
      <p role="status">Loading instructions…</p>
    ) : (
      <p className="template-catalog-job-message">
        {manifest?.automations?.[index]?.message ||
          "Instructions are unavailable for this release."}
      </p>
    ),
  }));
  if (workspace?.heartbeat)
    automations.push({
      key: "workspace:heartbeat",
      name: "Heartbeat checklist",
      description: workspace.heartbeat.every ? "Every " + workspace.heartbeat.every : undefined,
      details: (
        <>
          Workspace file · <code>{workspace.heartbeat.path}</code>
        </>
      ),
    });
  return (
    <section className="template-catalog-panel" aria-label="Included in this release">
      {personality}
      <CapabilitySection
        label="Skills"
        icon={Sparkles}
        rows={[...packages("skill"), ...workspaceRows("skills")]}
      />
      <CapabilitySection
        label="Plugins"
        dialog="metadata"
        icon={Plug}
        rows={[
          ...packages("plugin"),
          ...workspaceRows("plugins"),
          ...mcp.map((name) => ({
            key: "mcp:" + name,
            name,
            description: "MCP",
            details: "This Template declares this MCP server as an integration.",
          })),
        ]}
      />
      <CapabilitySection label="Automations" dialog="automation" icon={Clock} rows={automations} />
    </section>
  );
}
