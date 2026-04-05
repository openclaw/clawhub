import { useEffect, useRef, useState } from "react";
import { parse } from "@create-markdown/core";
import {
  blocksToHTML,
  renderAsync,
  shikiPlugin,
} from "@create-markdown/preview";
import { cn } from "../lib/utils";

interface MarkdownPreviewProps {
  children: string;
  className?: string;
  /** Enable Shiki syntax highlighting for code blocks (async). Default: true */
  highlight?: boolean;
}

/**
 * Rich markdown preview using @create-markdown/preview.
 * Renders markdown → HTML with optional Shiki syntax highlighting.
 * Falls back to synchronous (unhighlighted) rendering while Shiki loads.
 */
export function MarkdownPreview({
  children,
  className,
  highlight = true,
}: MarkdownPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Initial sync render (no highlighting) for instant display
  const [html, setHtml] = useState(() => {
    try {
      const blocks = parse(children);
      return blocksToHTML(blocks);
    } catch {
      return "";
    }
  });

  useEffect(() => {
    let cancelled = false;

    // Re-parse synchronously on content change
    try {
      const blocks = parse(children);
      const syncHtml = blocksToHTML(blocks);
      setHtml(syncHtml);

      if (!highlight) return;

      // Async render with Shiki syntax highlighting
      void renderAsync(blocks, {
        plugins: [shikiPlugin({ theme: "github-dark" })],
      }).then((highlighted) => {
        if (!cancelled) {
          setHtml(highlighted);
        }
      }).catch(() => {
        // Shiki failed to load — keep the sync render
      });
    } catch {
      // Parse failed — clear
      setHtml("");
    }

    return () => {
      cancelled = true;
    };
  }, [children, highlight]);

  return (
    <div
      ref={containerRef}
      className={cn("markdown", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
