export const SKILL_CAPABILITY_TAGS = [
  "crypto",
  "requires-wallet",
  "can-make-purchases",
  "can-sign-transactions",
  "requires-oauth-token",
  "posts-externally",
] as const;

export type SkillCapabilityTag = (typeof SKILL_CAPABILITY_TAGS)[number];

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function normalizeText(parts: Array<string | undefined>) {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n")
    .toLowerCase();
}

function matches(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

const CRYPTO_PATTERNS = [
  /\bcrypto\b/,
  /\bblockchain\b/,
  /\bdefi\b/,
  /\bon-?chain\b/,
  /\bwallet\b/,
  /\bprivate key\b/,
  /\berc20\b/,
  /\busdc\b/,
  /\beth(?:ereum)?\b/,
  /\bbase network\b/,
  /\barbitrum\b/,
  /\boptimism\b/,
  /\bpolygon\b/,
  /\bavalanche\b/,
  /\bsolana\b/,
  /\baave\b/,
  /\btoken balance\b/,
  /\bswap\b/,
  /\bbridge\b/,
  /\bliquidity\b/,
  /\bens\b/,
  /\bx402\b/,
] satisfies RegExp[];

const WALLET_PATTERNS = [
  /\bprivate[_ -]?key\b/,
  /\bwallet\b/,
  /\bmnemonic\b/,
  /\bseed phrase\b/,
  /\bconfigured wallet\b/,
  /\bsigner\b/,
  /\beip-712\b/,
] satisfies RegExp[];

const PURCHASE_PATTERNS = [
  /\bpay(?:ment|ments)?\b/,
  /\bpaid automatically\b/,
  /\bpay per call\b/,
  /\bmicro-?payments?\b/,
  /\bpayment required\b/,
  /\bcosts? \$\d/,
  /\bcharged?\b/,
  /\bpurchase\b/,
  /\bbuy(?:\s+(?:credits?|tokens?|coins?|nft|subscription|plan))\b/,
  /\bpayment checkout\b/,
  /\bone-?click checkout\b/,
] satisfies RegExp[];

const TRANSACTION_PATTERNS = [
  /\bsign(?:ing)? (?:and )?(?:submit|send|broadcast)? ?transactions?\b/,
  /\bsendtransaction\b/,
  /\bapproval_required\b/,
  /\bon-?chain (?:tx|transaction)\b/,
  /\bexecute(?:s|d)? transaction\b/,
  /\bbroadcast (?:transaction|tx)\b/,
  /\btransaction broadcast\b/,
  /\bwalletclient\.sendtransaction\b/,
] satisfies RegExp[];

const OAUTH_PATTERNS = [
  /\boauth(?: 2\.0)?\b/,
  /\baccess token\b/,
  /\brefresh token\b/,
  /\bbearer token\b/,
  /\btweet\.write\b/,
] satisfies RegExp[];

const EXTERNAL_POST_PATTERNS = [
  /\bpost(?: a| this)? tweet\b/,
  /\breply to (?:this )?tweet\b/,
  /\bquote tweet\b/,
  /\bpost to (?:x|twitter)\b/,
  /\btwitter-post\b/,
  /\bpublish post\b/,
] satisfies RegExp[];

export function deriveSkillCapabilityTags(params: {
  slug: string;
  displayName: string;
  summary?: string;
  frontmatter?: Record<string, unknown>;
  readmeText: string;
  fileContents?: Array<{ path: string; content: string }>;
}): SkillCapabilityTag[] {
  const text = normalizeText([
    params.slug,
    params.displayName,
    params.summary,
    safeJson(params.frontmatter),
    params.readmeText,
    ...(params.fileContents ?? []).map((file) => `${file.path}\n${file.content}`),
  ]);

  const tags = new Set<SkillCapabilityTag>();

  const isCrypto = matches(text, CRYPTO_PATTERNS);
  const requiresWallet = matches(text, WALLET_PATTERNS);
  const canMakePurchases = matches(text, PURCHASE_PATTERNS);
  const canSignTransactions = matches(text, TRANSACTION_PATTERNS);
  const requiresOauthToken = matches(text, OAUTH_PATTERNS);
  const postsExternally = matches(text, EXTERNAL_POST_PATTERNS);

  if (isCrypto) tags.add("crypto");
  if (requiresWallet) tags.add("requires-wallet");
  if (canMakePurchases) tags.add("can-make-purchases");
  if (canSignTransactions) tags.add("can-sign-transactions");
  if (requiresOauthToken) tags.add("requires-oauth-token");
  if (postsExternally) tags.add("posts-externally");

  if (canSignTransactions || canMakePurchases) {
    tags.add("crypto");
  }
  if (canSignTransactions) {
    tags.add("requires-wallet");
  }

  return SKILL_CAPABILITY_TAGS.filter((tag) => tags.has(tag));
}
