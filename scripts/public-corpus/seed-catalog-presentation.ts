#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertSeedTargetAllowed } from "../seed";
import { buildDummyOwnerPool, ownerForCorpusKey } from "./dummyOwners";
import { DEFAULT_PUBLIC_CORPUS_FIXTURE, parseCorpusJsonl, type PublicCorpusRow } from "./validate";

type Options = {
  previewName: string | null;
};

const ORG_IDENTITIES = [
  ["catalog-atlas", "Atlas Automation"],
  ["catalog-northstar", "Northstar Systems"],
  ["catalog-relay", "Relay Labs"],
  ["catalog-signal-forge", "Signal Forge"],
  ["catalog-harbor", "Harbor AI"],
  ["catalog-juniper", "Juniper Works"],
  ["catalog-orbit", "Orbit Tools"],
  ["catalog-prism", "Prism Stack"],
  ["catalog-canvas", "Canvas Labs"],
  ["catalog-threadline", "Threadline"],
  ["catalog-waypoint", "Waypoint Systems"],
  ["catalog-beacon", "Beacon Works"],
  ["catalog-mosaic", "Mosaic AI"],
  ["catalog-summit", "Summit Tools"],
  ["catalog-fieldnote", "Fieldnote Labs"],
  ["catalog-lattice", "Lattice Systems"],
] as const;

export function buildCatalogPresentationFixtures(rows: PublicCorpusRow[]) {
  const owners = buildDummyOwnerPool();
  const rowsByOwner = new Map<
    string,
    {
      skills: Extract<PublicCorpusRow, { kind: "skill" }>[];
      plugins: Extract<PublicCorpusRow, { kind: "plugin" }>[];
    }
  >();

  for (const row of rows) {
    const key = row.kind === "skill" ? `skill:${row.slug}` : `plugin:${row.name}`;
    const owner = ownerForCorpusKey(key, owners);
    const owned = rowsByOwner.get(owner.handle) ?? { skills: [], plugins: [] };
    if (row.kind === "skill") owned.skills.push(row);
    else owned.plugins.push(row);
    rowsByOwner.set(owner.handle, owned);
  }

  return ORG_IDENTITIES.map(([handle, displayName], index) => {
    const sourceOwner = owners[index];
    const owned = sourceOwner ? rowsByOwner.get(sourceOwner.handle) : undefined;
    const skill = owned?.skills[0];
    const plugin = owned?.plugins[0];
    if (!sourceOwner || !skill || !plugin) {
      throw new Error(`Public corpus cannot supply catalog presentation fixture ${displayName}`);
    }
    return {
      sourceOwnerHandle: sourceOwner.handle,
      handle,
      displayName,
      bio: "Synthetic official creator for local and pull request previews.",
      image: `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(handle)}`,
      skillSlug: skill.slug,
      packageName: plugin.name,
      featured: index < 8,
    };
  });
}

function parseArgs(args: string[]): Options {
  const options: Options = { previewName: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--preview-name") {
      options.previewName = readValue(args, ++index, arg);
    } else if (arg.startsWith("--preview-name=")) {
      options.previewName = arg.slice("--preview-name=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readValue(args: string[], index: number, flag: string) {
  const value = args[index]?.trim();
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  assertSeedTargetAllowed(options);

  const rows = parseCorpusJsonl(readFileSync(DEFAULT_PUBLIC_CORPUS_FIXTURE, "utf8"));
  const orgs = buildCatalogPresentationFixtures(rows);
  const targetArgs = options.previewName ? ["--preview-name", options.previewName] : ["--no-push"];
  const result = spawnSync(
    "bunx",
    [
      "convex",
      "run",
      ...targetArgs,
      "devSeed:seedCatalogPresentationFixtures",
      JSON.stringify({ orgs }),
    ],
    { cwd: process.cwd(), env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
