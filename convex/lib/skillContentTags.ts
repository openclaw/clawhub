/**
 * Content-level tags for skills — categories like "AI", "CLI", "Web" etc.
 * Derived automatically from slug + displayName + summary via keyword matching.
 * Stored on `skillSearchDigest.contentTags` (computed, not user-managed).
 */

export const SKILL_CONTENT_TAGS = [
  "ai",
  "cli",
  "web",
  "api",
  "git",
  "testing",
  "devops",
  "database",
  "docs",
  "code-quality",
  "security",
  "productivity",
  "data",
  "cloud",
  "design",
  "monitoring",
] as const;

export type SkillContentTag = (typeof SKILL_CONTENT_TAGS)[number];

export const SKILL_CONTENT_TAG_SET = new Set<string>(SKILL_CONTENT_TAGS);

export const SKILL_CONTENT_TAG_LABELS: Record<SkillContentTag, string> = {
  ai: "AI",
  cli: "CLI",
  web: "Web",
  api: "API",
  git: "Git",
  testing: "Testing",
  devops: "DevOps",
  database: "Database",
  docs: "Docs",
  "code-quality": "Code Quality",
  security: "Security",
  productivity: "Productivity",
  data: "Data",
  cloud: "Cloud",
  design: "Design",
  monitoring: "Monitoring",
};

// ---------------------------------------------------------------------------
// Keyword patterns per tag.  Patterns run against the lowercased concatenation
// of slug + displayName + summary.  Word-boundary anchors (\b) prevent false
// positives on substrings.
// ---------------------------------------------------------------------------

const TAG_PATTERNS: Record<SkillContentTag, RegExp[]> = {
  ai: [
    /\bai\b/,
    /\bartificial intelligence\b/,
    /\bmachine learning\b/,
    /\bml\b/,
    /\bllm\b/,
    /\bgpt[-\s]?\d?\b/,
    /\bclaude\b/,
    /\bchatgpt\b/,
    /\bopenai\b/,
    /\banthrop/,
    /\bembedding/,
    /\bneural/,
    /\btransformer/,
    /\bprompt engineer/,
    /\bgenerative\b/,
    /\bnlp\b/,
    /\bsentiment/,
    /\brag\b/,
    /\bvector search/,
    /\bcopilot\b/,
    /\bagent\b/,
    /\bchat\s?bot/,
  ],
  cli: [
    /\bcli\b/,
    /\bcommand[- ]?line/,
    /\bterminal\b/,
    /\bshell\b/,
    /\bbash\b/,
    /\bzsh\b/,
    /\bargparse\b/,
    /\bconsole\b/,
    /\btui\b/,
  ],
  web: [
    /\bweb\s?(dev|app|site|page)\b/,
    /\bhtml\b/,
    /\bcss\b/,
    /\breact\b/,
    /\bvue\b/,
    /\bsvelte\b/,
    /\bnext\.?js\b/,
    /\bfrontend\b/,
    /\bfront[- ]?end\b/,
    /\bwebsite\b/,
    /\bdom\b/,
    /\bresponsive/,
    /\bbrowser\b/,
    /\bseo\b/,
  ],
  api: [
    /\bapi\b/,
    /\brest\s?api\b/,
    /\bgraphql\b/,
    /\bendpoint/,
    /\bwebhook/,
    /\bswagger\b/,
    /\bopenapi\b/,
    /\bhttp\s?(client|request|call)/,
    /\bgrpc\b/,
  ],
  git: [
    /\bgit\b/,
    /\bgithub\b/,
    /\bgitlab\b/,
    /\bcommit/,
    /\bbranch(es|ing)?\b/,
    /\bpull request/,
    /\bmerge\b/,
    /\brebase\b/,
    /\brepository\b/,
    /\bdiff\b/,
    /\bversion control/,
  ],
  testing: [
    /\btest(s|ing|er)?\b/,
    /\bjest\b/,
    /\bvitest\b/,
    /\bmocha\b/,
    /\bcypress\b/,
    /\bplaywright\b/,
    /\bassertion/,
    /\bcoverage\b/,
    /\bunit test/,
    /\be2e\b/,
    /\bintegration test/,
    /\bqa\b/,
    /\bspec\b/,
    /\bsnapshot test/,
  ],
  devops: [
    /\bdevops\b/,
    /\bdocker\b/,
    /\bcontainer/,
    /\bkubernetes\b/,
    /\bk8s\b/,
    /\bci\/?cd\b/,
    /\bpipeline\b/,
    /\bdeploy(ment|ing)?\b/,
    /\binfrastructure/,
    /\bterraform\b/,
    /\bansible\b/,
    /\bhelm\b/,
    /\bnginx\b/,
  ],
  database: [
    /\bdatabase\b/,
    /\bsql\b/,
    /\bpostgres/,
    /\bmysql\b/,
    /\bmongodb?\b/,
    /\bredis\b/,
    /\bsqlite\b/,
    /\bmigration\b/,
    /\borm\b/,
    /\bprisma\b/,
    /\bdrizzle\b/,
    /\bsupabase\b/,
    /\bconvex\b/,
    /\bfirebase\b/,
    /\bdynamo/,
  ],
  docs: [
    /\bdocument(ation|ing)?\b/,
    /\breadme\b/,
    /\bmarkdown\b/,
    /\bwiki\b/,
    /\btechnical writ/,
    /\bjsdoc\b/,
    /\btypedoc\b/,
    /\bchangelog\b/,
    /\bknowledge base\b/,
  ],
  "code-quality": [
    /\blint(er|ing)?\b/,
    /\bformat(ter|ting)?\b/,
    /\brefactor/,
    /\bcode review/,
    /\bstyle guide/,
    /\bprettier\b/,
    /\beslint\b/,
    /\bbiome\b/,
    /\bcode quality/,
    /\bclean code/,
    /\bstatic analysis/,
    /\btype[- ]?check/,
  ],
  security: [
    /\bsecurity\b/,
    /\bauth(enticat|oriz)/,
    /\bencrypt/,
    /\bvulnerabilit/,
    /\bcve\b/,
    /\bowasp\b/,
    /\bpermission/,
    /\baccess control/,
    /\bfirewall/,
    /\bscan(ner|ning)?\b.*\b(security|vuln)/,
    /\bsecret/,
    /\bcredential/,
  ],
  productivity: [
    /\bworkflow\b/,
    /\bautomat(e|ion|ing)\b/,
    /\bproductiv/,
    /\btask\s?(manage|track|list)/,
    /\borgani[sz]/,
    /\bschedule/,
    /\bnotification/,
    /\breminder/,
    /\btemplate\b/,
    /\bsnippet/,
    /\bboilerplate/,
    /\bscaffold/,
  ],
  data: [
    /\bcsv\b/,
    /\bjson\b.*\b(pars|transform|process)/,
    /\betl\b/,
    /\btransform(ation|ing)?\b.*\bdata\b/,
    /\bdata\s?(pars|process|transform|analy|pipelin|clean|migrat)/,
    /\bscrape/,
    /\bcrawl/,
    /\bspreadsheet/,
    /\bexcel\b/,
  ],
  cloud: [
    /\baws\b/,
    /\bgcp\b/,
    /\bazure\b/,
    /\bs3\b/,
    /\blambda\b/,
    /\bserverless\b/,
    /\bcloud\b/,
    /\bvercel\b/,
    /\bnetlify\b/,
    /\bcloudflare\b/,
    /\bheroku\b/,
    /\bfly\.io\b/,
  ],
  design: [
    /\bfigma\b/,
    /\bui\s?\/?\s?ux\b/,
    /\baccessibilit/,
    /\ba11y\b/,
    /\bdesign system/,
    /\bcomponent librar/,
    /\btailwind/,
    /\bshadcn\b/,
    /\bstorybook\b/,
    /\bicon/,
    /\btheme/,
    /\bcolor\s?(scheme|palette)\b/,
  ],
  monitoring: [
    /\blog(s|ging|ger)?\b/,
    /\bmetric/,
    /\balert(s|ing)?\b/,
    /\bobservabilit/,
    /\bperformance\b/,
    /\bmonitor(ing)?\b/,
    /\btracing\b/,
    /\bsentry\b/,
    /\bdatadog\b/,
    /\buptime\b/,
    /\bhealth\s?check/,
  ],
};

/**
 * Derive content tags from a skill's slug, display name, and summary.
 * Returns a sorted array of matching tag slugs.
 */
export function deriveContentTags(params: {
  slug: string;
  displayName: string;
  summary?: string;
}): SkillContentTag[] {
  const text = [params.slug, params.displayName, params.summary ?? ""]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const matched: SkillContentTag[] = [];
  for (const tag of SKILL_CONTENT_TAGS) {
    if (TAG_PATTERNS[tag].some((pattern) => pattern.test(text))) {
      matched.push(tag);
    }
  }
  return matched;
}

export function isKnownContentTag(tag: string | undefined): tag is SkillContentTag {
  return typeof tag === "string" && SKILL_CONTENT_TAG_SET.has(tag);
}
