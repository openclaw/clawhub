import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type UrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { PluggableList } from "unified";
import { rehypeProxyImages } from "../lib/rehypeProxyImages";
import { cn } from "../lib/utils";

interface MarkdownPreviewProps {
  children: string;
  className?: string;
  /** Enable Shiki syntax highlighting for fenced code blocks. Default: true. */
  highlight?: boolean;
  urlTransform?: UrlTransform;
  /**
   * Base URL used to resolve relative <img src> values inside the README
   * (e.g. `./images/foo.png`). When set, relative sources are resolved
   * against this base and then routed through the standard image proxy.
   * Typical value: a `raw.githubusercontent.com/<repo>/<commit>/<dir>/` URL
   * derived from the package release's `verification.sourceRepo` +
   * `verification.sourceCommit`. Must end with `/`.
   */
  assetBaseUrl?: string;
}

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "picture", "source"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height"],
    source: ["media", "srcSet", "srcset", "type"],
    picture: [],
  },
};

// Order matters: rehype-sanitize runs BEFORE rehype-shiki so sanitize only
// sees user-authored HTML; shiki's trusted styled output flows through after.
// rehypeProxyImages rewrites after sanitize so we rewrite only already-safe
// <img src="..."> nodes (sanitize strips event handlers, javascript: URLs).
function buildBaseRehype(assetBaseUrl: string | undefined): PluggableList {
  return [rehypeRaw, [rehypeSanitize, schema], [rehypeProxyImages, { assetBaseUrl }]];
}

const SHIKI_THEME = "github-dark";
const SHIKI_LANGS = [
  "bash",
  "sh",
  "shell",
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "yaml",
  "md",
  "python",
  "nix",
  "http",
  "html",
  "css",
  "toml",
  "rust",
  "go",
  "dockerfile",
  "diff",
];

let highlighterPromise: Promise<unknown> | null = null;

function loadHighlighter(): Promise<unknown> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: [SHIKI_THEME],
        langs: SHIKI_LANGS,
      }),
    );
  }
  return highlighterPromise;
}

export function MarkdownPreview({
  children,
  className,
  highlight = true,
  urlTransform,
  assetBaseUrl,
}: MarkdownPreviewProps) {
  const [highlighter, setHighlighter] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    if (highlight) {
      loadHighlighter()
        .then((h) => {
          if (!cancelled) setHighlighter(h);
        })
        .catch(() => {
          // Shiki failed to initialize — keep plain rendering.
        });
    }
    return () => {
      cancelled = true;
    };
  }, [highlight]);

  const rehypePlugins = useMemo<PluggableList>(() => {
    const baseRehype = buildBaseRehype(assetBaseUrl);
    if (highlight && highlighter) {
      return [...baseRehype, [rehypeShikiFromHighlighter, highlighter, { theme: SHIKI_THEME }]];
    }
    return baseRehype;
  }, [highlight, highlighter, assetBaseUrl]);

  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        urlTransform={urlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
