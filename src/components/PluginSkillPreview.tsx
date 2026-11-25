import * as Dialog from "@radix-ui/react-dialog";
import type { PluginManifestSummary } from "clawhub-schema";
import { BookOpenText, X } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchPackageFile, PackageApiError } from "../lib/packageApi";
import "./PluginSkillPreview.css";

type Skill = PluginManifestSummary["bundledSkills"][number];
type Read = { content: string } | { error: string; retryable: boolean };
const unreadable = "Couldn’t read SKILL.md.";
const InsideLink = createContext(false);
const sentences = new Intl.Segmenter(undefined, { granularity: "sentence" });

// Control UI's skill-preview-document: escape authored HTML, keep relative link
// labels as text, and don't add code toolbars or silently load external images.
const components: Components = {
  a: ({ href, children, title }) => {
    if (!href || !(href.startsWith("//") || URL.canParse(href))) return <>{children}</>;
    return (
      <a href={href} title={title} target="_blank" rel="noreferrer">
        <InsideLink.Provider value>{children}</InsideLink.Provider>
      </a>
    );
  },
  img: function SkillImage({ src, alt }) {
    const inLink = useContext(InsideLink);
    const label = alt?.trim() || "image";
    if (typeof src !== "string" || !/^https?:\/\//i.test(src)) return <>{label}</>;
    return (
      <span>
        External image not loaded: {label}
        {inLink ? null : (
          <>
            {" "}
            <a href={src} target="_blank" rel="noreferrer">
              Open image
            </a>
          </>
        )}
      </span>
    );
  },
};

function SkillDocument({ content }: { content: string }) {
  // Strip only the leading YAML envelope, including BOM/CRLF files. The rest
  // belongs to the author: even plain paragraph labels and repeated titles stay.
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const envelope = /^---[^\S\n]*\n(?:[\s\S]*?\n)?---[^\S\n]*(?:\n|$)/.exec(normalized);
  if (!envelope && /^---[^\S\n]*\n\s*[\w-]+:/u.test(normalized)) {
    return <p role="alert">{unreadable}</p>;
  }
  const body = normalized.slice(envelope?.[0].length ?? 0);
  return (
    <article className="markdown catalog-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {body}
      </ReactMarkdown>
    </article>
  );
}

// Mounted by the portal only after the user chooses a particular release's skill.
function Reader({
  packageName,
  version,
  path,
}: {
  packageName: string;
  version: string;
  path: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<Read | null>(null);
  useEffect(() => {
    let current = true;
    void fetchPackageFile(packageName, path, version).then(
      (content) => {
        if (current)
          setRead(content === null ? { error: unreadable, retryable: true } : { content });
      },
      (error: unknown) => {
        if (!current) return;
        const tooLarge = error instanceof PackageApiError && error.status === 413;
        setRead({
          error: tooLarge
            ? "SKILL.md is too large to preview."
            : error instanceof Error
              ? error.message
              : unreadable,
          retryable: !tooLarge,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [packageName, version, path, attempt]);
  return (
    <>
      <div className="plugin-catalog-overview catalog-skill-preview-body" aria-busy={!read}>
        {read === null ? (
          <div role="status" aria-label="Loading…" className="catalog-skill-preview-skeleton">
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : "content" in read ? (
          <SkillDocument content={read.content} />
        ) : (
          <p role="alert">{read.error}</p>
        )}
      </div>
      {read && "error" in read && read.retryable ? (
        <footer>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRead(null);
              setAttempt(attempt + 1);
            }}
          >
            Retry
          </button>
        </footer>
      ) : null}
    </>
  );
}

// Port of ui/src/pages/plugins/skill-preview.tsx (PluginSkillPreview), not the
// Template inventory file viewer or the standalone Skill library dialog.
export function PluginSkillPreview({
  skill,
  packageName,
  version,
  publisherHandle,
}: {
  skill: Skill;
  packageName: string;
  version: string;
  publisherHandle?: string;
}) {
  const summary = sentences
    .segment(skill.description?.trim() ?? "")
    .containing(0)
    ?.segment.trim();
  const panel = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="catalog-skill-preview-overlay" />
      <Dialog.Content
        className="catalog-skill-preview-dialog"
        ref={panel}
        {...(!summary && { "aria-describedby": undefined })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          panel.current?.focus({ preventScroll: true });
        }}
      >
        <header>
          <div className="catalog-skill-preview-identity">
            <span className="catalog-skill-preview-icon" aria-hidden="true">
              <BookOpenText />
            </span>
            <div className="catalog-skill-preview-text">
              <div className="catalog-skill-preview-title-row">
                <Dialog.Title>{skill.name}</Dialog.Title>
                {publisherHandle ? <span>@{publisherHandle}</span> : null}
              </div>
              {summary ? <Dialog.Description>{summary}</Dialog.Description> : null}
            </div>
          </div>
          <Dialog.Close type="button" className="catalog-skill-preview-close" aria-label="Close">
            <X aria-hidden="true" />
          </Dialog.Close>
        </header>
        <Reader packageName={packageName} version={version} path={skill.skillMdPath} />
      </Dialog.Content>
    </Dialog.Portal>
  );
}
