import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import type { HighlighterGeneric } from "shiki";
import type { PluggableList } from "unified";
import { cn } from "../lib/utils";

interface MarkdownPreviewProps {
  children: string;
  className?: string;
  /** Enable Shiki syntax highlighting for fenced code blocks. Default: true. */
  highlight?: boolean;
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
const baseRehype: PluggableList = [rehypeRaw, [rehypeSanitize, schema]];

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

type AnyHighlighter = HighlighterGeneric<string, string>;
let highlighterPromise: Promise<AnyHighlighter> | null = null;

function loadHighlighter(): Promise<AnyHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(
      ({ createHighlighter }) =>
        createHighlighter({
          themes: [SHIKI_THEME],
          langs: SHIKI_LANGS,
        }) as Promise<AnyHighlighter>,
    );
  }
  return highlighterPromise;
}

export function MarkdownPreview({ children, className, highlight = true }: MarkdownPreviewProps) {
  const [highlighter, setHighlighter] = useState<AnyHighlighter | null>(null);

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
    if (highlight && highlighter) {
      return [
        ...baseRehype,
        [rehypeShikiFromHighlighter, highlighter, { theme: SHIKI_THEME }],
      ];
    }
    return baseRehype;
  }, [highlight, highlighter]);

  return (
    <div className={cn("markdown", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
