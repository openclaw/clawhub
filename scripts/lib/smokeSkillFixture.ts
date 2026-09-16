type FixtureResponse = {
  status: number;
  json: () => Promise<unknown>;
};

type SkillDetail = {
  skill: { slug: string; displayName: string; summary: string | null };
  latestVersion: { version: string | null } | null;
  owner: { handle: string };
};

export async function loadSmokeSkillFixture(
  request: (path: string) => Promise<FixtureResponse>,
  env: { CLAWHUB_E2E_SKILL_SLUG?: string; CLAWHUB_E2E_SKILL_OWNER?: string } = process.env,
) {
  const slug = env.CLAWHUB_E2E_SKILL_SLUG?.trim() || "gifgrep";
  const owner = env.CLAWHUB_E2E_SKILL_OWNER?.trim().replace(/^@+/, "");
  const detailPath = `/api/v1/skills/${encodeURIComponent(slug)}`;
  const params = new URLSearchParams(owner ? { ownerHandle: owner } : {});
  let response = await request(`${detailPath}${params.size ? `?${params}` : ""}`);
  if (response.status === 409 && !owner) {
    const ambiguity = (await response.json()) as {
      code?: string;
      matches?: Array<{ ownerHandle: string; slug: string }>;
    };
    // Test snapshots replace publisher handles. A unique response owns its identity;
    // a collision must retain the known production fixture, never the first match.
    const knownFixture =
      slug === "gifgrep" &&
      ambiguity.code === "AMBIGUOUS_SKILL_SLUG" &&
      ambiguity.matches?.some((match) => match.slug === slug && match.ownerHandle === "steipete");
    if (!knownFixture) {
      throw new Error(`Ambiguous skill fixture ${slug}; set CLAWHUB_E2E_SKILL_OWNER explicitly`);
    }
    response = await request(`${detailPath}?ownerHandle=steipete`);
  }
  if (response.status !== 200) {
    throw new Error(
      `Skill fixture ${owner ? `@${owner}/` : ""}${slug} returned ${response.status}`,
    );
  }
  const detail = (await response.json()) as SkillDetail;
  if (
    !detail?.owner?.handle?.trim() ||
    !detail.skill?.displayName?.trim() ||
    detail.skill.slug !== slug
  ) {
    throw new Error(
      `Skill fixture ${detailPath} needs its owner, requested slug, and display name`,
    );
  }
  return {
    ...detail,
    filePath: `${detailPath}/file?${new URLSearchParams({ path: "SKILL.md", ownerHandle: detail.owner.handle })}`,
  };
}
