import { buildDeterministicZip, validateFilePath } from "./skillZip";

const AGENT_SKILLS_DISCOVERY_SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";

type DiscoveryPin =
  | { version: string; commit?: never; contentHash?: never }
  | { version?: never; commit: string; contentHash: string };

export function buildAgentSkillsDiscoveryDocument(
  args: {
    origin: string;
    ownerHandle: string;
    slug: string;
    displayName: string;
    description?: string | null;
    digest: string;
  } & DiscoveryPin,
) {
  const archiveUrl = new URL(
    `/api/v1/agent-skills/${encodeURIComponent(args.ownerHandle)}/${encodeURIComponent(args.slug)}/archive`,
    args.origin,
  );
  if (args.version !== undefined) {
    archiveUrl.searchParams.set("version", args.version);
  } else {
    archiveUrl.searchParams.set("commit", args.commit!);
    archiveUrl.searchParams.set("contentHash", args.contentHash!);
  }

  return {
    $schema: AGENT_SKILLS_DISCOVERY_SCHEMA,
    skills: [
      {
        name: args.slug,
        type: "archive" as const,
        description: normalizeDescription(args.description, args.displayName),
        url: archiveUrl.toString(),
        digest: `sha256:${args.digest}`,
      },
    ],
  };
}

export function buildNormalizedAgentSkillArchive(
  entries: Record<string, Uint8Array>,
  rootPath = "",
) {
  const normalizedRoot = rootPath.replace(/^\/+|\/+$/g, "");
  const rootPrefix = normalizedRoot ? `${normalizedRoot}/` : "";
  const selected = Object.entries(entries)
    .flatMap(([rawPath, bytes]) => {
      const path = rawPath.replace(/^\/+/, "");
      if (rootPrefix && !path.startsWith(rootPrefix)) return [];
      const relativePath = rootPrefix ? path.slice(rootPrefix.length) : path;
      if (!relativePath || !validateFilePath(relativePath)) return [];
      return [{ path: relativePath, bytes: new Uint8Array(bytes) }];
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const skillFile =
    selected.find((entry) => entry.path === "SKILL.md") ??
    selected.find((entry) => entry.path.toLowerCase() === "skill.md") ??
    selected.find((entry) => entry.path.toLowerCase() === "skills.md");
  if (!skillFile) {
    throw new Error("Skill archive is missing SKILL.md");
  }

  const normalized = selected
    .filter((entry) => entry !== skillFile && entry.path !== "SKILL.md")
    .map((entry) => ({ path: entry.path, bytes: entry.bytes }));
  normalized.push({ path: "SKILL.md", bytes: skillFile.bytes });

  return buildDeterministicZip(normalized);
}

function normalizeDescription(description: string | null | undefined, displayName: string) {
  const normalized = description?.trim() || `${displayName} from ClawHub.`;
  return normalized.slice(0, 1024);
}
