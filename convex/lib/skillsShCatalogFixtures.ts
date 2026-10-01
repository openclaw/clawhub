import frozenSnapshot from "../fixtures/skills-sh-500-2026-07-21.json";

export type SkillsShCatalogFixtureRow = {
  externalId: string;
  githubOwnerId: number;
  owner: string;
  repo: string;
  slug: string;
  displayName: string;
  sourceUrl: string;
  githubRepoUrl: string;
  githubPath?: string;
  githubCommit?: string;
  githubContentHash?: string;
  claimPublisherHandle?: string;
  sourceContentHash: string;
  installs: number;
  githubStars?: number;
};

type SkillsShCatalogFixture = {
  snapshotId: string;
  sourceKind: "fixture" | "frozen-snapshot";
  capturedAt: string | null;
  snapshotCaptureFetches: number;
  length: number;
  rowAt: (index: number) => SkillsShCatalogFixtureRow;
  findByExternalId: (externalId: string) => SkillsShCatalogFixtureRow | null;
};

const AIQ_DEPLOY: SkillsShCatalogFixtureRow = {
  externalId: "nvidia/skills/aiq-deploy",
  githubOwnerId: 1_728_152,
  owner: "nvidia",
  repo: "skills",
  slug: "aiq-deploy",
  displayName: "AIQ Deploy",
  sourceUrl: "https://www.skills.sh/nvidia/skills/aiq-deploy",
  githubRepoUrl: "https://github.com/NVIDIA/skills",
  sourceContentHash: "c087fae29cc3882e03116c37921a7e092c42b15a04aa9a6c503e000a3e260ab5",
  installs: 100,
};

const AIQ_DEPLOY_V2: SkillsShCatalogFixtureRow = {
  ...AIQ_DEPLOY,
  displayName: "AIQ Deploy Updated",
  sourceContentHash: "d087fae29cc3882e03116c37921a7e092c42b15a04aa9a6c503e000a3e260ab5",
  installs: 101,
};

const PATRICK_HTML_CANARY: SkillsShCatalogFixtureRow = {
  externalId: "patrick-erichsen/skills/html",
  githubOwnerId: 20_157_849,
  owner: "patrick-erichsen",
  repo: "skills",
  slug: "html",
  displayName: "HTML Artifact Chooser",
  sourceUrl: "https://www.skills.sh/patrick-erichsen/skills/html",
  githubRepoUrl: "https://github.com/Patrick-Erichsen/skills",
  githubPath: "skills/html",
  githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
  githubContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
  claimPublisherHandle: "patrick-erichsen",
  sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
  installs: 17,
  githubStars: 321,
};

const FROZEN_ROWS = frozenSnapshot.rows satisfies SkillsShCatalogFixtureRow[];

function fromRows(
  metadata: Omit<SkillsShCatalogFixture, "length" | "rowAt" | "findByExternalId">,
  rows: readonly SkillsShCatalogFixtureRow[],
): SkillsShCatalogFixture {
  const byExternalId = new Map(rows.map((row) => [row.externalId, row]));
  return {
    ...metadata,
    length: rows.length,
    rowAt(index) {
      const row = rows[index];
      if (!row) throw new Error(`skills.sh fixture row ${index} is out of bounds`);
      return row;
    },
    findByExternalId(externalId) {
      return byExternalId.get(externalId) ?? null;
    },
  };
}

function changedFrozenRows() {
  return FROZEN_ROWS.map((row, index) => {
    if (index === 0) {
      return {
        ...row,
        displayName: `${row.displayName} Updated`,
        sourceContentHash: `${row.sourceContentHash.slice(0, -1)}${
          row.sourceContentHash.endsWith("0") ? "1" : "0"
        }`,
        installs: row.installs + 1,
      };
    }
    if (index === 1) {
      return {
        ...row,
        installs: row.installs + 1,
      };
    }
    return row;
  });
}

const SYNTHETIC_DISCOVERY_LENGTH = 20_000;

function syntheticDiscoveryRow(index: number): SkillsShCatalogFixtureRow {
  if (!Number.isInteger(index) || index < 0 || index >= SYNTHETIC_DISCOVERY_LENGTH) {
    throw new Error(`skills.sh synthetic fixture row ${index} is out of bounds`);
  }
  const suffix = index.toString().padStart(5, "0");
  return {
    externalId: `synthetic-owner/synthetic-repo/skill-${suffix}`,
    githubOwnerId: 9_999_999,
    owner: "synthetic-owner",
    repo: "synthetic-repo",
    slug: `skill-${suffix}`,
    displayName: `Synthetic Skill ${suffix}`,
    sourceUrl: `https://www.skills.sh/synthetic-owner/synthetic-repo/skill-${suffix}`,
    githubRepoUrl: "https://github.com/synthetic-owner/synthetic-repo",
    sourceContentHash: index.toString(16).padStart(64, "0"),
    installs: index,
  };
}

const FIXTURES = {
  "patrick-html-canary-v1": fromRows(
    {
      snapshotId: "patrick-html-canary-v1",
      sourceKind: "fixture",
      capturedAt: null,
      snapshotCaptureFetches: 0,
    },
    [PATRICK_HTML_CANARY],
  ),
  "nvidia-small-v1": fromRows(
    {
      snapshotId: "nvidia-small-v1",
      sourceKind: "fixture",
      capturedAt: null,
      snapshotCaptureFetches: 0,
    },
    [
      AIQ_DEPLOY,
      { ...AIQ_DEPLOY },
      {
        externalId: "nvidia/skills/cuda-agent",
        githubOwnerId: 1_728_152,
        owner: "nvidia",
        repo: "skills",
        slug: "cuda-agent",
        displayName: "CUDA Agent",
        sourceUrl: "https://www.skills.sh/nvidia/skills/cuda-agent",
        githubRepoUrl: "https://github.com/NVIDIA/skills",
        sourceContentHash: "b087fae29cc3882e03116c37921a7e092c42b15a04aa9a6c503e000a3e260ab5",
        installs: 50,
      },
    ],
  ),
  "nvidia-small-v2": fromRows(
    {
      snapshotId: "nvidia-small-v2",
      sourceKind: "fixture",
      capturedAt: null,
      snapshotCaptureFetches: 0,
    },
    [AIQ_DEPLOY_V2],
  ),
  "skills-sh-500-2026-07-21": fromRows(
    {
      snapshotId: frozenSnapshot.snapshotId,
      sourceKind: "frozen-snapshot",
      capturedAt: frozenSnapshot.capturedAt,
      snapshotCaptureFetches: frozenSnapshot.captureMetrics.skillsShFetches,
    },
    FROZEN_ROWS,
  ),
  "skills-sh-500-2026-07-21-v2": fromRows(
    {
      snapshotId: `${frozenSnapshot.snapshotId}-v2`,
      sourceKind: "frozen-snapshot",
      capturedAt: frozenSnapshot.capturedAt,
      snapshotCaptureFetches: frozenSnapshot.captureMetrics.skillsShFetches,
    },
    changedFrozenRows(),
  ),
  "synthetic-20000-v1": {
    snapshotId: "synthetic-20000-v1",
    sourceKind: "fixture",
    capturedAt: null,
    snapshotCaptureFetches: 0,
    length: SYNTHETIC_DISCOVERY_LENGTH,
    rowAt: syntheticDiscoveryRow,
    findByExternalId(externalId) {
      const match = /^synthetic-owner\/synthetic-repo\/skill-(\d{5})$/.exec(externalId);
      if (!match) return null;
      const index = Number(match[1]);
      return index < SYNTHETIC_DISCOVERY_LENGTH ? syntheticDiscoveryRow(index) : null;
    },
  },
} satisfies Record<string, SkillsShCatalogFixture>;

export type SkillsShCatalogFixtureId = keyof typeof FIXTURES;

export function getSkillsShCatalogFixture(
  fixtureId: SkillsShCatalogFixtureId,
): SkillsShCatalogFixture {
  return FIXTURES[fixtureId];
}
