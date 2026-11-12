export function makePublicSkillsShDigest() {
  return {
    externalId: "patrick-erichsen/skills/html",
    sourceType: "github" as const,
    owner: "patrick-erichsen",
    repo: "skills",
    slug: "html",
    displayName: "HTML Artifact Chooser",
    sourceUrl: "https://skills.sh/patrick-erichsen/skills/html",
    githubPath: "skills/html",
    githubCommit: "050daba89f6b6636470add5cb300aac46a412cf8",
    sourceContentHash: "a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f",
    upstreamInstalls: 100,
    upstreamScanners: {
      genAgentTrustHub: { status: "unavailable" },
      socket: { status: "pass" },
      snyk: { status: "warning" },
    },
    sourceFreshnessStatus: "observed-only" as const,
    detailStatus: "available" as const,
    active: true,
    publicVisible: true,
    installable: true,
    lastObservedAt: 123,
  };
}
