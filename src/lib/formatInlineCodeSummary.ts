export type InlineCodeSummarySegment =
  | { type: "text"; value: string }
  | { type: "code"; value: string };

const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;

export function parseInlineCodeSummary(text: string): InlineCodeSummarySegment[] {
  const segments: InlineCodeSummarySegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_CODE_PATTERN)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
    }
    segments.push({ type: "code", value: match[1] });
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: text }];
}
