export type SkillCardSection = {
  level: 1 | 2 | 3;
  title: string;
  body: string;
};

export type SkillCardSectionGroup =
  | { kind: "title"; section: SkillCardSection }
  | { kind: "meta"; sections: SkillCardSection[] }
  | { kind: "prose"; section: SkillCardSection };

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

function isMetadataSection(section: SkillCardSection) {
  const title = section.title.toLowerCase();
  if (
    title === "publisher" ||
    title.includes("license") ||
    title.includes("deployment geography") ||
    title.includes("skill version")
  ) {
    return true;
  }

  return section.level === 3 && section.body.length < 160 && !section.body.includes("\n\n");
}

export function groupSkillCardSections(sections: SkillCardSection[]): SkillCardSectionGroup[] {
  const groups: SkillCardSectionGroup[] = [];

  for (const section of sections) {
    if (section.level === 1) {
      groups.push({ kind: "title", section });
      continue;
    }

    if (isMetadataSection(section)) {
      const last = groups.at(-1);
      if (last?.kind === "meta") {
        last.sections.push(section);
      } else {
        groups.push({ kind: "meta", sections: [section] });
      }
      continue;
    }

    groups.push({ kind: "prose", section });
  }

  return groups;
}
