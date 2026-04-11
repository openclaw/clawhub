import { parse } from "@create-markdown/core";
import { blocksToHTML, renderAsync, shikiPlugin } from "@create-markdown/preview";
import { useEffect, useRef, useState } from "react";
import { cn } from "../lib/utils";

interface MarkdownPreviewProps {
  children: string;
  className?: string;
  /** Enable Shiki syntax highlighting for code blocks (async). Default: true */
  highlight?: boolean;
}

function getResolvedTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function useResolvedTheme(): "light" | "dark" {
  const [theme, setTheme] = useState(getResolvedTheme);

  useEffect(() => {
    setTheme(getResolvedTheme());

    const observer = new MutationObserver(() => setTheme(getResolvedTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return theme;
}

/**
 * Auto-link bare URLs in HTML that aren't already inside anchor tags or attributes.
 * Matches http/https URLs in text nodes only (not inside tags).
 */
function autolinkURLs(html: string): string {
  return html.replace(
    /(<[^>]*>)|((https?:\/\/)[^\s<>"')\]]+)/gi,
    (match, tag: string | undefined, url: string | undefined) => {
      if (tag) return tag;
      if (url) {
        const trailingPunct = /[.,;:!?)]+$/.exec(url);
        const cleanUrl = trailingPunct ? url.slice(0, -trailingPunct[0].length) : url;
        const suffix = trailingPunct ? trailingPunct[0] : "";
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${suffix}`;
      }
      return match;
    },
  );
}

/**
 * Rich markdown preview using @create-markdown/preview.
 * Renders markdown → HTML with optional Shiki syntax highlighting.
 * Falls back to synchronous (unhighlighted) rendering while Shiki loads.
 */
export function MarkdownPreview({ children, className, highlight = true }: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedTheme = useResolvedTheme();

  const [html, setHtml] = useState(() => {
    try {
      const blocks = parse(children);
      return autolinkURLs(blocksToHTML(blocks));
    } catch {
      return "";
    }
  });

  useEffect(() => {
    let cancelled = false;

    try {
      const blocks = parse(children);
      const syncHtml = autolinkURLs(blocksToHTML(blocks));
      setHtml(syncHtml);

      if (!highlight) return;

      const shikiTheme = resolvedTheme === "dark" ? "github-dark" : "github-light";

      void renderAsync(blocks, {
        plugins: [shikiPlugin({ theme: shikiTheme })],
      })
        .then((highlighted) => {
          if (!cancelled) {
            setHtml(autolinkURLs(highlighted));
          }
        })
        .catch(() => {
          // Shiki failed to load — keep the sync render
        });
    } catch {
      setHtml("");
    }

    return () => {
      cancelled = true;
    };
  }, [children, highlight, resolvedTheme]);

  return (
    <div
      ref={containerRef}
      className={cn("markdown", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
