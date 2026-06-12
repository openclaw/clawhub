import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import { isValidElement, useEffect, useId, useMemo, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
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
// image URLs (sanitize strips event handlers, javascript: URLs).
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

type MermaidApi = (typeof import("mermaid"))["default"];

let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

type MermaidRenderState =
  | { status: "loading" }
  | { status: "rendered"; svg: string }
  | { status: "error"; message: string };

function stringifyReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(stringifyReactNode).join("");
  return "";
}

function removeMermaidRenderArtifacts(diagramId: string) {
  for (const id of [diagramId, `d${diagramId}`, `i${diagramId}`]) {
    document.getElementById(id)?.remove();
  }
}

function MermaidDiagram({ source }: { source: string }) {
  const rawId = useId();
  const diagramId = useMemo(
    () => `clawhub-mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [rawId],
  );
  const [state, setState] = useState<MermaidRenderState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    loadMermaid()
      .then(async (mermaid) => {
        let svg: string;
        try {
          ({ svg } = await mermaid.render(diagramId, source));
        } finally {
          removeMermaidRenderArtifacts(diagramId);
        }
        if (!cancelled) setState({ status: "rendered", svg });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Unable to render Mermaid diagram",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [diagramId, source]);

  if (state.status === "error") {
    return (
      <pre className="mermaid-diagram-error" data-mermaid-error={state.message}>
        <code className="language-mermaid">{source}</code>
      </pre>
    );
  }

  return (
    <div className="mermaid-diagram" data-mermaid-diagram="" data-state={state.status}>
      {state.status === "rendered" ? (
        <div className="mermaid-diagram__svg" dangerouslySetInnerHTML={{ __html: state.svg }} />
      ) : (
        <span className="mermaid-diagram__loading">Rendering diagram...</span>
      )}
    </div>
  );
}

function MarkdownPre({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const child = Array.isArray(children) ? children[0] : children;

  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const className = child.props.className ?? "";
    if (/\blanguage-mermaid\b/i.test(className)) {
      const source = stringifyReactNode(child.props.children).replace(/\n$/, "");
      return <MermaidDiagram source={source} />;
    }
  }

  return <pre {...props}>{children}</pre>;
}

const MARKDOWN_COMPONENTS = {
  pre: MarkdownPre,
};

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
        components={MARKDOWN_COMPONENTS}
        urlTransform={urlTransform}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
