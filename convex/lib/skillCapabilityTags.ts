export const SKILL_CAPABILITY_TAGS = [
  "crypto",
  "financial-authority",
  "requires-wallet",
  "can-make-purchases",
  "can-sign-transactions",
  "requires-paid-service",
  "requires-oauth-token",
  "requires-sensitive-credentials",
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

function removeMatches(text: string, patterns: RegExp[]) {
  return patterns.reduce(
    (result, pattern) => result.replace(new RegExp(pattern.source, `${pattern.flags}g`), " "),
    text,
  );
}

const CRYPTO_PATTERNS = [
  /\bcrypto\b/,
  /\bcryptocurrenc(?:y|ies)\b/,
  /\bblockchain\b/,
  /\bdefi\b/,
  /\bon-?chain\b/,
  /\bwallet\b/,
  /\bprivate key\b/,
  /\bwalletclient\b/,
  /\bsendtransaction\b/,
  /\beip-712\b/,
  /\berc-?20\b/,
  /\bbitcoin\b/,
  /\bbtc\b/,
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
  /\b(?:defi|token|tokens|coin|coins|nft|nfts|usdc|eth|ethereum|erc20|crypto)\s+swaps?\b/,
  /\bswaps?\s+(?:defi|token|tokens|coin|coins|nft|nfts|usdc|eth|ethereum|erc20|crypto)\b/,
  /\b(?:buy|buys|buying|bought|purchas(?:e|es|ed|ing))\s+(?:[\w-]+\s+){0,2}(?:coins?|nfts?|cryptocurrenc(?:y|ies))\b/,
  /\b(?:buy|buys|buying|bought|purchas(?:e|es|ed|ing))\s+(?:[\w-]+\s+){0,2}(?:crypto|defi|on-?chain|wallet|erc-?20|ethereum|bitcoin|btc|eth|usdc|solana|polygon|base|arbitrum|optimism|avalanche)\s+tokens?\b/,
  /\bbridge\b/,
  /\bliquidity\b/,
  /\bens\b/,
  /\bx402\b/,
] satisfies RegExp[];

const WALLET_PATTERNS = [
  /\bprivate[_ -]?key\b/,
  /\bwallet\b/,
  /\bwalletclient\b/,
  /\bsendtransaction\b/,
  /\bmnemonic\b/,
  /\bseed phrase\b/,
  /\bconfigured wallet\b/,
  /\bsigner\b/,
  /\beip-712\b/,
] satisfies RegExp[];

const PURCHASE_PATTERNS = [
  /\bpay\s+(?:for|with|using|via|in)\s+(?:[\w-]+\s+){0,6}(?:after|with|upon|on)\s+(?:explicit\s+)?(?:user\s+)?(?:approval|confirmation|consent)\b/,
  /\bpaid automatically\b/,
  /\bmicro-?payments?\b/,
  /\b(?:process(?:es|ed|ing)?|accept(?:s|ed|ing)?|collect(?:s|ed|ing)?|captur(?:e|es|ed|ing)|settl(?:e|es|ed|ing))\s+(?:[\w-]+\s+){0,4}payments?\b/,
  /\b(?:make|makes|making|made|send|sends|sending|sent|initiat(?:e|es|ed|ing)|schedul(?:e|es|ed|ing)|approv(?:e|es|ed|ing)|authoriz(?:e|es|ed|ing))\s+(?:[\w-]+\s+){0,4}payments?\b/,
  /\bpay(?:s|ing)?\s+(?:[\w-]+\s+){0,3}(?:invoices?|bills?|vendors?|suppliers?|merchants?)\b/,
  /\bpayment processing\b/,
  /\bcharg(?:e|es|ed|ing)\s+(?:[\w-]+\s+){0,3}(?:cards?|credit cards?|customers?|users?|accounts?)\b/,
  /\b(?:make|makes|making|made|complete|completes|completed|place|places|placed|submit|submits|submitted)\s+(?:a\s+)?(?:[\w-]+\s+){0,3}(?:one-?time\s+)?purchases?\b/,
  /\b(?:(?:this|the|your)\s+)?(?:skill|agent|assistant|tool|workflow|integration)\s+(?:can\s+|may\s+|will\s+|is\s+able\s+to\s+|able\s+to\s+)?(?:buy|buys|buying|bought|order|orders|ordered|ordering|purchas(?:e|es|ed|ing))\s+(?:a|an|the)?\s*(?:[\w-]+\s+){0,3}(?:products?|items?|goods?|books?|groceries|supplies|materials?|equipment|merchandise|orders?|licenses?|domain names?|domains?|gift cards?)\b/,
  /\b(?:buy|buys|buying|bought|purchas(?:e|es|ed|ing))\s+(?:[\w-]+\s+){0,2}(?:credits?|tokens?|coins?|nfts?|subscriptions?|plans?)\b/,
  /\b(?:(?:this|the|an?|your)\s+)?(?:[\w-]+\s+){0,2}(?:skill|agent|assistant|tool|workflow|integration)\s+(?:can|may|is\s+able\s+to|able\s+to)\s+(?:buy|purchase)\b/,
  /\b(?:buy|purchase|order)\s+(?:(?:a|an|the)\s+)?(?:[\w-]+\s+){0,6}(?:after|with|upon|on)\s+(?:explicit\s+)?(?:user\s+)?(?:approval|confirmation|consent)\b/,
  /\b(?:book|books|booked|booking|reserv(?:e|es|ed|ing))\s+(?:[\w-]+\s+){0,3}(?:hotels?|flights?|airline tickets?|tickets?|travel|rental cars?)\s+(?:after|with|upon|on)\s+(?:explicit\s+)?(?:user\s+)?(?:approval|confirmation|consent)\b/,
  /\b(?:subscrib(?:e|es|ed|ing)(?:\s+to)?|renew(?:s|ed|ing)?|upgrad(?:e|es|ed|ing))\s+(?:[\w-]+\s+){0,3}(?:subscriptions?|plans?|memberships?|licenses?|domains?|accounts?|tiers?)\s+(?:after|with|upon|on)\s+(?:explicit\s+)?(?:user\s+)?(?:approval|confirmation|consent)\b/,
  /\bpayment checkout\b/,
  /\bone-?click checkout\b/,
] satisfies RegExp[];

const PAID_SERVICE_PATTERNS = [
  /(?<!no )\bpayment required\b/,
  /(?<!no )\bpayments?\s+(?:is|are|was|were|be|being|been)?\s*required\b/,
  /(?<!no )\bpaid (?:subscription|plan|account|service|tier|api|provider|membership)\s+(?:is|are|was|were|be|being|been)?\s*required\b/,
  /(?<!not )(?<!n't )\brequires? (?:a )?(?:subscription(?!\s+(?:ids?|identifiers?|keys?|to)\b)|payment(?!\s+(?:methods?|details?|info|cards?|sources?)\b))\b/,
  /(?<!not )(?<!n't )\brequires? (?:a )?(?:pro|premium|billing) (?:subscription|plan|tier|account|service|api|provider|membership)\b/,
  /(?<!not )(?<!n't )\brequires? (?:a )?paid (?:subscription|plan|account|service|tier|api|provider|membership)\b/,
  /\bpay per call\b/,
  /\busers?\s+pay\s+for\s+(?:[\w-]+\s+){0,4}(?:api|provider|service|skill|tool|calls?|requests?|usage)\b/,
  /\bpay\s+for\s+(?:[\w-]+\s+){0,4}(?:api|provider|service|skill|tool|calls?|requests?|usage)\b/,
  /\b(?:this\s+)?(?:skill|tool|api|provider|service|subscription|plans?|calls?|requests?)\s+costs?\s+\$\d/,
  /\b(?:provider|api|service|skill|tool|subscription|plans?)\s+charges?\s+\$\d/,
  /\busers?\s+(?:is|are|was|were|will be|can be)?\s*charged\s+\$\d/,
  /\b(?:pricing|price|cost|costs?|paid|subscription|plan)\b[\s\S]{0,80}\bone-?time purchase\b/,
  /\b(?:is|are|be|being|been)?\s*charged per (?:call|request|use|execution|run)\b/,
  /\bcharges? per (?:call|request|use|execution|run)\b/,
  /\b(?:http 402|402 payment required|payment required)[\s\S]{0,80}\binsufficient (?:account )?balance\b/,
  /\binsufficient (?:skill|billing|payment|provider|api) account balance\b/,
  /\baccount (?:top-?up|recharge)\b/,
  /\b(?:top ?up|recharge) (?:the )?(?:skill )?account\b/,
  /账户余额不足/,
  /技能账户充值/,
  /安装支付技能/,
] satisfies RegExp[];

const NEGATED_PAID_SERVICE_PATTERNS = [
  /\bno\s+(?:(?:additional|extra|further)\s+)?payments?\s+(?:(?:is|are|was|were|be|being|been)\s+)?required\b/,
  /\bnever\s+requires?\s+(?:a\s+)?(?:(?:paid|pro|premium|billing)\s+)?(?:subscription|payment|plan|account|service|tier|api|provider|membership)\b/,
  /\b(?:do|does|did)\s+not\s+(?:currently\s+|also\s+|normally\s+|usually\s+)?requires?\s+(?:a\s+)?(?:(?:paid|pro|premium|billing)\s+)?(?:subscription|payment|plan|account|service|tier|api|provider|membership)\b/,
  /\b(?:do|does|did)n['’]t\s+(?:currently\s+|also\s+|normally\s+|usually\s+)?requires?\s+(?:a\s+)?(?:(?:paid|pro|premium|billing)\s+)?(?:subscription|payment|plan|account|service|tier|api|provider|membership)\b/,
] satisfies RegExp[];

const TRANSACTION_PATTERNS = [
  /\bsign(?:s|ed|ing)?\s+(?!in(?:to)?\b|up\b|out\b|on(?:to)?\b|off\b)(?:and\s+)?(?:(?:submit|send|broadcast|authorize|approve)\s+)?(?:[\w-]+\s+){0,4}transactions?\b/,
  /\b(?:send|sends|sending|sent|submit|submits|submitting|submitted|broadcast|broadcasts|broadcasting|broadcasted|authorize|authorizes|authorizing|authorized|approve|approves|approving|approved)\s+(?:[\w-]+\s+){0,4}(?:ach|bank|wire|payment|card|credit|debit|invoice|vendor|supplier|merchant|ethereum|eth|bitcoin|btc|crypto|on-?chain|wallet|tokens?|coins?|nfts?|usdc|erc-?20)\s+(?:[\w-]+\s+){0,4}transactions?\b/,
  /\bsendtransaction\b/,
  /\bapproval_required\b/,
  /\bon-?chain (?:tx|transaction)\b/,
  /\bexecute(?:s|d)? transaction\b/,
  /\bbroadcast (?:transaction|tx)\b/,
  /\btransaction broadcast\b/,
  /\bwalletclient\.sendtransaction\b/,
] satisfies RegExp[];

const NON_FINANCIAL_TRANSACTION_PATTERNS = [
  /\b(?:signs?|signed|signing|executes?|executed|executing|approves?|approved|approving)\s+(?:[\w-]+\s+){0,3}(?:database|sql|postgres|mysql|internal|workflow)\s+transactions?\b/,
] satisfies RegExp[];

const OAUTH_PATTERNS = [
  /\boauth(?: 2\.0)?\b/,
  /\baccess token\b/,
  /\brefresh token\b/,
  /\bbearer token\b/,
  /\btweet\.write\b/,
] satisfies RegExp[];

const SENSITIVE_CREDENTIAL_PATTERNS = [
  /api[_ -]?key\b/,
  /\baccess token\b/,
  /\brefresh token\b/,
  /\bbearer token\b/,
  /\bsession (?:cookie|cookies)\b/,
  /\bauth(?:entication)? (?:cookie|cookies)\b/,
  /\bprivate[_ -]?key\b/,
  /\bmnemonic\b/,
  /\bseed phrase\b/,
  /\bsigner\b/,
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
  const paidServiceText = removeMatches(text, NEGATED_PAID_SERVICE_PATTERNS);
  const requiresPaidService = matches(paidServiceText, PAID_SERVICE_PATTERNS);
  const transactionText = removeMatches(text, NON_FINANCIAL_TRANSACTION_PATTERNS);
  const canSignTransactions = matches(transactionText, TRANSACTION_PATTERNS);
  const requiresOauthToken = matches(text, OAUTH_PATTERNS);
  const requiresSensitiveCredentials = matches(text, SENSITIVE_CREDENTIAL_PATTERNS);
  const postsExternally = matches(text, EXTERNAL_POST_PATTERNS);
  const hasFinancialAuthority = canMakePurchases || canSignTransactions;

  if (isCrypto) tags.add("crypto");
  if (hasFinancialAuthority) tags.add("financial-authority");
  if (requiresWallet) tags.add("requires-wallet");
  if (canMakePurchases) tags.add("can-make-purchases");
  if (canSignTransactions) tags.add("can-sign-transactions");
  if (requiresPaidService) tags.add("requires-paid-service");
  if (requiresOauthToken) tags.add("requires-oauth-token");
  if (requiresSensitiveCredentials) tags.add("requires-sensitive-credentials");
  if (postsExternally) tags.add("posts-externally");

  if (canSignTransactions && isCrypto) {
    tags.add("requires-wallet");
  }
  if (tags.has("requires-wallet") || canSignTransactions || requiresOauthToken) {
    tags.add("requires-sensitive-credentials");
  }

  return SKILL_CAPABILITY_TAGS.filter((tag) => tags.has(tag));
}
