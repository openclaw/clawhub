import type { PluginManifestSummary } from "clawhub-schema";
import { Fragment, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MarkdownPreview } from "./MarkdownPreview";
import { PluginSkillPreview } from "./PluginSkillPreview";
import { Dialog, DialogTrigger } from "./ui/dialog";
import "./PluginCatalogOverview.css";

type OverviewProps = {
  manifest: PluginManifestSummary | null;
  publisherHandle?: string;
  packageName: string;
  version: string | null;
  readme: string | null;
  readmeAssetBaseUrl?: string;
};
type BundledSkill = PluginManifestSummary["bundledSkills"][number];
type McpServer = PluginManifestSummary["mcpServers"][number];

// Keep the public catalog in Control UI display order (plugins/overview.tsx).
// These are labels for published contracts, not inferences from a plugin's name or category.
const capabilityFamilies = [
  {
    family: "speechProviders",
    name: "Text to speech",
    description: "Turn text into spoken audio.",
    path: "M3 5h8M7 5v10m-3 0h6m3-5h3l4-4v14l-4-4h-3Zm9 0v6",
  },
  {
    family: "realtimeTranscriptionProviders",
    name: "Live transcription",
    description: "Transcribe audio as it arrives.",
    path: "M7 2za3 3 0 0 1 3 3v5a3 3 0 0 1-3 3 3 3 0 0 1-3-3V5a3 3 0 0 1 3-3m-6 8a6 6 0 0 0 12 0m-6 6v5m-3 0h6m6-15h6m-6 5h4m-4 5h6",
  },
  {
    family: "realtimeVoiceProviders",
    name: "Realtime voice",
    description: "Support live voice conversations.",
    path: "M2 10v4m4-7v10m4-7v4m4-7v10m4-7v4m4-7v10M4 3h13m-2-2 2 2-2 2m5 16H7m2-2-2 2 2 2",
  },
  {
    family: "mediaUnderstandingProviders",
    name: "Media understanding",
    description: "Analyze supported media inputs.",
    path: "M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m13-5v4a1 1 0 0 1-1 1h-4M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5m10 0a2 2 0 1 1-4 0 2 2 0 1 1 4 0",
  },
  {
    family: "imageGenerationProviders",
    name: "Image generation",
    description: "Create images from prompts and supported references.",
    path: "M12 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-8M3 17l5-5 4 4 3-3 6 6M18 2l1 3 3 1-3 1-1 3-1-3-3-1 3-1ZM8.5 7.5a1 1 0 1 1-2 0 1 1 0 1 1 2 0",
  },
  {
    family: "videoGenerationProviders",
    name: "Video generation",
    description: "Create video with supported generation models.",
    path: "M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M2 7h20M2 17h20M7 3v4m5-4v4m5-4v4M7 17v4m5-4v4m5-4v4m-7-11 5 2-5 2Z",
  },
  {
    family: "musicGenerationProviders",
    name: "Music generation",
    description: "Create music with supported generation models.",
    path: "M9 18V5l12-3v13M9 9l12-3M3 2v4M1 4h4m4 14a3.5 3 0 1 1-7 0 3.5 3 0 1 1 7 0m12-3a3.5 3 0 1 1-7 0 3.5 3 0 1 1 7 0",
  },
  {
    family: "embeddingProviders",
    name: "Embeddings",
    description: "Represent content for semantic search and retrieval.",
    path: "M7 5h10M6 7l5 9m7-9-5 9M8 5a3 3 0 1 1-6 0 3 3 0 1 1 6 0m14 0a3 3 0 1 1-6 0 3 3 0 1 1 6 0m-7 14a3 3 0 1 1-6 0 3 3 0 1 1 6 0m-6-8h6",
  },
  {
    family: "webSearchProviders",
    name: "Web search",
    description: "Find information on the web.",
    path: "M14 8a6 6 0 1 1-12 0 6 6 0 1 1 12 0Z M8 2c-3 3-3 9 0 12 3-3 3-9 0-12Z M2 8h12 M21 17.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0Z M20 20l2.5 2.5",
  },
  {
    family: "webFetchProviders",
    name: "Web fetching",
    description: "Read content from web pages.",
    path: "M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M2 8h20M6 5.5h.01M12 11v7m-3-3 3 3 3-3",
  },
  {
    family: "webContentExtractors",
    name: "Web content extraction",
    description: "Extract readable content from web pages.",
    path: "M11 21H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4M2 8h20M6 5.5h.01M6 12h6m-6 4h3m5 0h9m-3-3 3 3-3 3",
  },
  {
    family: "documentExtractors",
    name: "Document extraction",
    description: "Extract content from supported documents.",
    path: "M11 22H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9l5 5v4m-6-9v6h6M7 12h4m-4 4h3m4 1h9m-3-3 3 3-3 3",
  },
  {
    family: "transcriptSourceProviders",
    name: "Transcripts",
    description: "Capture or import transcripts from supported sources.",
    path: "M7 2h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2M2 6v14a2 2 0 0 0 2 2h13M9 7h3m-3 4h8m-8 4h6",
  },
  {
    family: "migrationProviders",
    name: "Migration",
    description: "Bring supported data into OpenClaw.",
    path: "M4 9V4a1 1 0 0 1 1-1h13a1 1 0 0 1 1 1v5m-7-8v13m-4-4 4 4 4-4M3 12l-1 8a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1l-1-8M2 16h5l2 3h6l2-3h5",
  },
];

const iconPaths = {
  book: "M12 5v16M16 13h2M16 9h2 M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z M6 13h2M6 9h2",
  wrench:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  plug: "M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z",
  right: "M9 18l6-6-6-6",
  up: "m18 15-6-6-6 6",
  down: "M6 9l6 6 6-6",
};

function Glyph({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

function CapabilitySection({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: ReactNode;
}) {
  const heading = useId();
  return (
    <section id={id} aria-labelledby={heading} className="catalog-section">
      <h2 className="catalog-label" id={heading}>
        {title}
      </h2>
      <div className="catalog-group">{children}</div>
    </section>
  );
}

function RowContent({
  path,
  name,
  description,
  chevron,
}: {
  path: string;
  name: string;
  description?: string;
  chevron?: boolean;
}) {
  return (
    <>
      <span className="catalog-icon">
        <Glyph path={path} />
      </span>
      <span className="catalog-row-text">
        <span className="catalog-row-title">{name}</span>
        {description ? <span className="catalog-row-description">{description}</span> : null}
      </span>
      {chevron ? (
        <span className="catalog-chevron">
          <Glyph path={iconPaths.right} />
        </span>
      ) : null}
    </>
  );
}

function SkillRow({
  packageName,
  version,
  publisherHandle,
  skill,
}: Pick<OverviewProps, "packageName" | "version" | "publisherHandle"> & { skill: BundledSkill }) {
  const row = (
    <RowContent
      path={iconPaths.book}
      name={skill.name}
      description={skill.description}
      chevron={Boolean(version)}
    />
  );
  if (!version) return <div className="catalog-row">{row}</div>;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="catalog-row" aria-label={`Preview ${skill.name}`}>
          {row}
        </button>
      </DialogTrigger>
      <PluginSkillPreview
        skill={skill}
        packageName={packageName}
        version={version}
        publisherHandle={publisherHandle}
      />
    </Dialog>
  );
}

const authLabels = { oauth: "OAuth", "api-key": "API key", none: "None" };

function McpRow({ server }: { server: McpServer }) {
  const fields = [
    [
      "Endpoint",
      server.endpointRedacted
        ? "Withheld because the endpoint may contain private connection details."
        : server.url,
    ],
    ["Transport", server.transport],
    ["Authentication", server.auth ? authLabels[server.auth] : undefined],
    ["Requested permissions", server.scope],
  ].filter(([, value]) => value);
  return (
    <details className="catalog-disclosure">
      <summary className="catalog-row">
        <RowContent path={iconPaths.plug} name={server.name} chevron />
      </summary>
      <div className="catalog-server-details">
        {fields.length ? (
          <dl>
            {fields.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))}
          </dl>
        ) : null}
        {server.setup ? <p>{server.setup}</p> : null}
        {!fields.length && !server.setup ? (
          <p>Connection details are not included in this plugin’s catalog metadata.</p>
        ) : null}
      </div>
    </details>
  );
}

function ReadmeWell({ readme, assetBaseUrl }: { readme: string; assetBaseUrl?: string }) {
  const id = useId();
  const body = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return undefined;
    const measure = () => {
      const limit =
        Number.parseFloat(getComputedStyle(element).getPropertyValue("--plugin-readme-clamp")) ||
        170;
      setOverflows(element.scrollHeight > limit + 24);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Images and syntax highlighting can resize the document even while its outer box is clamped.
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [readme]);
  return (
    <section className="catalog-section" aria-labelledby={id + "-label"}>
      <h2 className="catalog-label" id={id + "-label"}>
        Readme
      </h2>
      <div className="catalog-readme-well" data-clamped={!expanded && overflows}>
        <div className="catalog-readme-body" id={id} ref={body} data-analytics-public-detail="">
          <article>
            <MarkdownPreview className="catalog-markdown" assetBaseUrl={assetBaseUrl}>
              {readme}
            </MarkdownPreview>
          </article>
        </div>
        <button
          type="button"
          className="catalog-readme-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          hidden={!expanded && !overflows}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
          <Glyph path={expanded ? iconPaths.up : iconPaths.down} />
        </button>
      </div>
    </section>
  );
}

export function PluginCatalogOverview({
  manifest,
  publisherHandle,
  packageName,
  version,
  readme,
  readmeAssetBaseUrl,
}: OverviewProps) {
  const capabilities = capabilityFamilies.filter(
    ({ family }) => manifest?.contracts?.[family]?.length,
  );
  const skills = manifest?.bundledSkills ?? [];
  const tools = manifest?.contracts?.tools ?? [];
  const servers = manifest?.mcpServers ?? [];
  if (!capabilities.length && !skills.length && !tools.length && !servers.length && !readme)
    return null;
  return (
    <div className="plugin-catalog-overview">
      {capabilities.length ? (
        <CapabilitySection title="Capabilities">
          {capabilities.map(({ family, path, name, description }) => (
            <div className="catalog-row" key={family}>
              <RowContent path={path} name={name} description={description} />
            </div>
          ))}
        </CapabilitySection>
      ) : null}
      {skills.length ? (
        <CapabilitySection id="skills" title="Skills">
          {skills.map((skill) => (
            <SkillRow
              key={JSON.stringify([packageName, version, skill.skillMdPath])}
              packageName={packageName}
              version={version}
              skill={skill}
              publisherHandle={publisherHandle}
            />
          ))}
        </CapabilitySection>
      ) : null}
      {tools.length ? (
        <CapabilitySection title="Tools">
          {tools.map((name) => (
            <div className="catalog-row" key={name}>
              <RowContent path={iconPaths.wrench} name={name} />
            </div>
          ))}
        </CapabilitySection>
      ) : null}
      {servers.length ? (
        <CapabilitySection
          id="mcp-servers"
          title={servers.length === 1 ? "MCP server" : "MCP servers"}
        >
          {servers.map((server) => (
            <McpRow key={server.name} server={server} />
          ))}
        </CapabilitySection>
      ) : null}
      {readme ? (
        <ReadmeWell
          key={JSON.stringify([packageName, version])}
          readme={readme}
          assetBaseUrl={readmeAssetBaseUrl}
        />
      ) : null}
    </div>
  );
}
