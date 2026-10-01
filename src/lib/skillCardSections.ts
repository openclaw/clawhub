export type SkillCardSection = {
  level: 1 | 2 | 3;
  title: string;
  body: string;
};

const HEADING_RE = /^(#{1,3})\s+(.+)$/;

export function normalizeSkillCardTitle(raw: string) {
  return raw
    .replace(/<br\s*\/?>/gi, "")
    .replace(/:+\s*$/u, "")
    .trim();
}

export function parseSkillCardSections(markdown: string): SkillCardSection[] {
  const lines = markdown.split(/\r?\n/u);
  const sections: SkillCardSection[] = [];
  let preamble = "";
  let current: SkillCardSection | null = null;

  const pushCurrent = () => {
    if (!current) return;
    sections.push({ ...current, body: current.body.trim() });
    current = null;
  };

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      pushCurrent();
      if (preamble.trim()) {
        sections.push({ level: 2, title: "", body: preamble.trim() });
        preamble = "";
      }
      current = {
        level: match[1].length as 1 | 2 | 3,
        title: normalizeSkillCardTitle(match[2]),
        body: "",
      };
      continue;
    }

    if (current) {
      current.body += current.body ? `\n${line}` : line;
    } else {
      preamble += preamble ? `\n${line}` : line;
    }
  }

  pushCurrent();
  if (preamble.trim()) {
    sections.push({ level: 2, title: "", body: preamble.trim() });
  }

  return sections.filter((section) => section.title || section.body);
}
