export type SkillsShCatalogFixtureRow = {
  owner: string;
  githubOwnerId: number;
  repo: string;
  slug: string;
  displayName: string;
  sourceUrl: string;
  githubPath: string;
  githubCommit: string;
  githubContentHash: string;
  githubCheckedAt: number;
};

const AIQ_DEPLOY: SkillsShCatalogFixtureRow = {
  owner: "nvidia",
  githubOwnerId: 1728152,
  repo: "skills",
  slug: "aiq-deploy",
  displayName: "AIQ Deploy",
  sourceUrl: "https://github.com/NVIDIA/skills/tree/main/skills/aiq-deploy",
  githubPath: "skills/aiq-deploy",
  githubCommit: "1111111111111111111111111111111111111111",
  githubContentHash: "c087fae29cc3882e03116c37921a7e092c42b15a04aa9a6c503e000a3e260ab5",
  githubCheckedAt: 1_752_883_200_000,
};

const AIQ_DEPLOY_V2: SkillsShCatalogFixtureRow = {
  ...AIQ_DEPLOY,
  githubCommit: "3333333333333333333333333333333333333333",
  githubContentHash: "d087fae29cc3882e03116c37921a7e092c42b15a04aa9a6c503e000a3e260ab5",
  githubCheckedAt: 1_752_969_600_000,
};

const FIXTURES = {
  "nvidia-small-v1": [
    AIQ_DEPLOY,
    { ...AIQ_DEPLOY },
    {
      owner: "nvidia",
      githubOwnerId: 1728152,
      repo: "skills",
      slug: "cuda-agent",
      displayName: "CUDA Agent",
      sourceUrl: "https://github.com/NVIDIA/skills/tree/main/skills/cuda-agent",
      githubPath: "skills/cuda-agent",
      githubCommit: "2222222222222222222222222222222222222222",
      githubContentHash: "b087fae29cc3882e03116c37921a7e092c42b15a04aa9a6c503e000a3e260ab5",
      githubCheckedAt: 1_752_883_200_000,
    },
  ],
  "nvidia-small-v2": [AIQ_DEPLOY_V2],
} satisfies Record<string, SkillsShCatalogFixtureRow[]>;

export type SkillsShCatalogFixtureId = keyof typeof FIXTURES;

export function getSkillsShCatalogFixture(
  fixtureId: SkillsShCatalogFixtureId,
): readonly SkillsShCatalogFixtureRow[] {
  return FIXTURES[fixtureId];
}
