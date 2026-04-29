#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const RESCAN_GUIDANCE_LABEL = "r: rescan-guidance";
export const RESCAN_GUIDANCE_COMMENT_MARKER = "<!-- clawhub-rescan-guidance -->";
export const SUPPRESS_LABEL = "skip-rescan-guidance";

const DEFAULT_REPO = "openclaw/clawhub";
const DEFAULT_LIMIT = 100;
const APPLY_CONFIRM_ENV = "CLAWHUB_RESCAN_GUIDANCE_APPLY";

const explicitIntentRules = [
  {
    id: "explicit-rescan",
    pattern:
      /\b(?:re[-\s]?scan|rerun(?:ning)?\s+(?:the\s+)?(?:security\s+)?scan|re-run\s+(?:the\s+)?(?:security\s+)?scan|run\s+(?:the\s+)?(?:security\s+)?scan\s+again|scan\s+again)\b/i,
  },
  {
    id: "re-evaluation",
    pattern: /\b(?:re[-\s]?evaluat(?:e|ion)|reassess|re-assess|re[-\s]?review)\b/i,
  },
  {
    id: "reclassification",
    pattern:
      /\b(?:re[-\s]?classif(?:y|ication)|remove\s+(?:the\s+)?suspicious\s+flag|clear\s+(?:the\s+)?suspicious\s+flag|mark\s+(?:it\s+)?(?:as\s+)?(?:clean|benign))\b/i,
  },
  {
    id: "review-after-fix",
    pattern:
      /\b(?:security\s+flag\s+review|scan\s+flag\s+review|(?:request(?:ing)?|please)\s+(?:a\s+)?(?:manual\s+)?(?:review|security\s+review)\b[\s\S]{0,120}\b(?:after|fix(?:ed|es|ing)?|updated?|metadata|current\s+version|latest\s+version|new\s+version)|review\s+request\b[\s\S]{0,120}\b(?:after|fix(?:ed|es|ing)?|updated?|metadata|current\s+version|latest\s+version|new\s+version))\b/i,
  },
  {
    id: "fixed-and-still-flagged",
    pattern:
      /\b(?:(?:after|despite)\s+(?:fixing|fixes|metadata\s+fixes|clarifying|removing)|fix(?:ed|es)?\s+.*\b(?:still|yet)\s+.*\b(?:flagged|suspicious))\b/i,
  },
];

const moderationContextRules = [
  {
    id: "clawhub-asset",
    pattern: /\b(?:skill|plugin|package|publisher|published|version|clawhub)\b/i,
  },
  {
    id: "moderation-signal",
    pattern:
      /\b(?:suspicious|flagged\s+(?:as\s+)?suspicious|security\s+scan|scanner|virustotal|vt\b|openclaw\s+verdict|moderation|malicious|benign|clean)\b/i,
  },
];

const negativeContextRules = [
  {
    id: "auth-login",
    pattern: /\b(?:login|log\s+in|sign[-\s]?in|oauth|unauthorized|token|callback)\b/i,
  },
  {
    id: "install-rate-limit",
    pattern: /\b(?:install(?:ing)?|rate\s+limit|429|download|npx)\b/i,
  },
  {
    id: "search-indexing",
    pattern: /\b(?:search|indexed|indexing|explore|catalog|disappeared|hidden)\b/i,
  },
];

export const rescanGuidanceComment = [
  RESCAN_GUIDANCE_COMMENT_MARKER,
  'Thanks for the report. Please use the "Rescan" button on the skill/plugin page while signed in as the owner.',
  "",
  "You can also request a fresh scan from the CLI:",
  "- Skill: `clawhub skill rescan <slug>`",
  "- Plugin/package: `clawhub package rescan <name>`",
  "",
  "If the content or metadata changed, publish the fixed version first, then request the rescan for the latest release. I'm closing this issue after posting this guidance. If you're still having trouble after rescanning, please reopen this issue with the ClawHub URL, version, and latest scan result.",
].join("\n");

function normalizeLabel(label) {
  if (typeof label === "string") return label.trim().toLowerCase();
  if (label && typeof label.name === "string") return label.name.trim().toLowerCase();
  return "";
}

function issueLabels(issue) {
  return Array.isArray(issue.labels) ? issue.labels.map(normalizeLabel).filter(Boolean) : [];
}

function issueState(issue) {
  return String(issue.state ?? "")
    .trim()
    .toUpperCase();
}

function issueText(issue) {
  return `${issue.title ?? ""}\n${issue.body ?? ""}`.trim();
}

function matchingRuleIds(rules, text) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.id);
}

function commentHash(body) {
  return createHash("sha256").update(body).digest("hex");
}

export function classifyRescanRequest(issue) {
  const labels = issueLabels(issue);
  const state = issueState(issue);
  const text = issueText(issue);

  if (state && state !== "OPEN") {
    return {
      matched: false,
      matchedRules: [],
      reason: `Skipped because issue state is ${state.toLowerCase()}.`,
      actions: [],
    };
  }

  if (issue.pull_request || issue.isPullRequest) {
    return {
      matched: false,
      matchedRules: [],
      reason: "Skipped because this is a pull request.",
      actions: [],
    };
  }

  if (labels.includes(SUPPRESS_LABEL)) {
    return {
      matched: false,
      matchedRules: [],
      reason: `Skipped because ${SUPPRESS_LABEL} is present.`,
      actions: [],
    };
  }

  if (labels.includes(RESCAN_GUIDANCE_LABEL)) {
    return {
      matched: false,
      matchedRules: [],
      reason: `Skipped because ${RESCAN_GUIDANCE_LABEL} is already present.`,
      actions: [],
    };
  }

  if (/\b(?:false\s+duplicate|duplicate\s+flag|not\s+a\s+duplicate|duplicate\s+of)\b/i.test(text)) {
    return {
      matched: false,
      matchedRules: [],
      reason:
        "Skipped because this looks like a duplicate-classification appeal, not a rescan request.",
      actions: [],
    };
  }

  const explicitMatches = matchingRuleIds(explicitIntentRules, text);
  if (explicitMatches.length === 0) {
    return {
      matched: false,
      matchedRules: [],
      reason: "No explicit rescan, re-evaluation, review, or reclassification request found.",
      actions: [],
    };
  }

  const contextMatches = matchingRuleIds(moderationContextRules, text);
  if (contextMatches.length < moderationContextRules.length) {
    return {
      matched: false,
      matchedRules: explicitMatches,
      reason: "Explicit request found, but it lacks ClawHub asset and moderation/scan context.",
      actions: [],
    };
  }

  const negativeMatches = matchingRuleIds(negativeContextRules, text);
  const hasStrongModerationLanguage =
    /\b(?:suspicious|flagged|virustotal|vt\b|malicious|benign|clean|security\s+scan|scanner|moderation)\b/i.test(
      text,
    );
  if (negativeMatches.length > 0 && !hasStrongModerationLanguage) {
    return {
      matched: false,
      matchedRules: [...explicitMatches, ...contextMatches],
      reason: `Skipped because it looks like ${negativeMatches.join(", ")} support rather than a moderation rescan request.`,
      actions: [],
    };
  }

  const matchedRules = [...explicitMatches, ...contextMatches];
  return {
    matched: true,
    matchedRules,
    reason: `Explicit rescan guidance match: ${matchedRules.join(", ")}.`,
    actions: planRescanGuidanceActions(),
  };
}

export function planRescanGuidanceActions() {
  return [
    {
      type: "add_label",
      label: RESCAN_GUIDANCE_LABEL,
    },
  ];
}

export function planCommentForLabeledIssue(issue) {
  const labels = issueLabels(issue);
  const state = issueState(issue);

  if (state && state !== "OPEN") {
    return {
      matched: false,
      matchedRules: [],
      reason: `Skipped because issue state is ${state.toLowerCase()}.`,
      actions: [],
    };
  }

  if (issue.pull_request || issue.isPullRequest) {
    return {
      matched: false,
      matchedRules: [],
      reason: "Skipped because this is a pull request.",
      actions: [],
    };
  }

  if (!labels.includes(RESCAN_GUIDANCE_LABEL)) {
    return {
      matched: false,
      matchedRules: [],
      reason: `Skipped because ${RESCAN_GUIDANCE_LABEL} is not present.`,
      actions: [],
    };
  }

  return {
    matched: true,
    matchedRules: ["rescan-guidance-label"],
    reason: `Matched because ${RESCAN_GUIDANCE_LABEL} is present.`,
    actions: [
      {
        type: "comment",
        body: rescanGuidanceComment,
        bodySha256: commentHash(rescanGuidanceComment),
      },
      {
        type: "close",
        stateReason: "not_planned",
      },
    ],
  };
}

function parseArgs(argv) {
  const args = {
    repo: DEFAULT_REPO,
    limit: DEFAULT_LIMIT,
    issues: [],
    dryRun: true,
    json: true,
    commentForLabeledIssue: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--repo") {
      args.repo = requireValue(argv, (index += 1), "--repo");
    } else if (arg === "--limit") {
      args.limit = Number.parseInt(requireValue(argv, (index += 1), "--limit"), 10);
    } else if (arg === "--issue" || arg === "--item") {
      args.issues.push(Number.parseInt(requireValue(argv, (index += 1), arg), 10));
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.dryRun = false;
    } else if (arg === "--comment-for-labeled-issue") {
      args.commentForLabeledIssue = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1) {
    throw new Error("--limit must be a positive integer.");
  }
  if (args.issues.some((issue) => !Number.isInteger(issue) || issue < 1)) {
    throw new Error("--issue values must be positive integers.");
  }
  if (args.commentForLabeledIssue && args.issues.length === 0) {
    throw new Error("--comment-for-labeled-issue requires --issue.");
  }
  if (!args.dryRun && process.env[APPLY_CONFIRM_ENV] !== "1") {
    throw new Error(`--apply requires ${APPLY_CONFIRM_ENV}=1.`);
  }
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function ghJson(args) {
  const stdout = execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function gh(args, input) {
  execFileSync("gh", args, {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  });
}

function ghOk(args) {
  try {
    gh(args);
    return true;
  } catch {
    return false;
  }
}

function labelApiName(label) {
  return encodeURIComponent(label);
}

function ensureGuidanceLabel(repo) {
  if (ghOk(["api", `repos/${repo}/labels/${labelApiName(RESCAN_GUIDANCE_LABEL)}`])) return;
  const created = ghOk([
    "label",
    "create",
    RESCAN_GUIDANCE_LABEL,
    "--repo",
    repo,
    "--color",
    "bfdadc",
    "--description",
    "Rescan guidance has been posted for this ClawHub item",
  ]);
  if (!created && !ghOk(["api", `repos/${repo}/labels/${labelApiName(RESCAN_GUIDANCE_LABEL)}`])) {
    throw new Error(`Could not create or find label: ${RESCAN_GUIDANCE_LABEL}`);
  }
}

function normalizeGhIssue(issue) {
  return {
    number: issue.number,
    title: issue.title ?? "",
    body: issue.body ?? "",
    state: issue.state ?? "",
    url: issue.url ?? issue.html_url ?? "",
    labels: issue.labels ?? [],
  };
}

async function fetchIssues(options) {
  if (options.issues.length > 0) {
    return options.issues.map((issueNumber) =>
      normalizeGhIssue(
        ghJson([
          "issue",
          "view",
          String(issueNumber),
          "--repo",
          options.repo,
          "--json",
          "number,title,body,state,url,labels",
        ]),
      ),
    );
  }

  return ghJson([
    "issue",
    "list",
    "--repo",
    options.repo,
    "--state",
    "open",
    "--limit",
    String(options.limit),
    "--json",
    "number,title,body,state,url,labels",
  ]).map(normalizeGhIssue);
}

export function planIssue(issue) {
  const classification = classifyRescanRequest(issue);
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    matched: classification.matched,
    matchedRules: classification.matchedRules,
    reason: classification.reason,
    actions: classification.actions,
  };
}

function writeCommentPayload(plan) {
  const commentAction = plan.actions.find((action) => action.type === "comment");
  if (!commentAction) return null;
  return JSON.stringify({ body: commentAction.body });
}

function hasExistingGuidanceComment(repo, number) {
  const comments = ghJson([
    "api",
    `repos/${repo}/issues/${number}/comments?per_page=100`,
    "--jq",
    `[.[] | {body}]`,
  ]);
  return comments.some((comment) =>
    String(comment.body ?? "").includes(RESCAN_GUIDANCE_COMMENT_MARKER),
  );
}

function applyPlan(plan, options) {
  if (!plan.matched) return { number: plan.number, applied: false, reason: plan.reason };
  if (plan.actions.some((action) => action.type === "add_label")) {
    ensureGuidanceLabel(options.repo);
  }
  const existingGuidanceComment = hasExistingGuidanceComment(options.repo, plan.number);
  const appliedActions = [];
  for (const action of plan.actions) {
    if (action.type === "add_label") {
      gh([
        "api",
        `repos/${options.repo}/issues/${plan.number}/labels`,
        "--method",
        "POST",
        "--field",
        `labels[]=${action.label}`,
      ]);
      appliedActions.push(action.type);
    } else if (action.type === "comment") {
      if (existingGuidanceComment) continue;
      gh(
        [
          "api",
          `repos/${options.repo}/issues/${plan.number}/comments`,
          "--method",
          "POST",
          "--input",
          "-",
        ],
        writeCommentPayload(plan),
      );
      appliedActions.push(action.type);
    } else if (action.type === "close") {
      gh(
        ["api", `repos/${options.repo}/issues/${plan.number}`, "--method", "PATCH", "--input", "-"],
        JSON.stringify({ state: "closed", state_reason: action.stateReason ?? "not_planned" }),
      );
      appliedActions.push(action.type);
    }
  }
  return {
    number: plan.number,
    applied: appliedActions.length > 0,
    actions: appliedActions,
    skippedComment: existingGuidanceComment,
  };
}

function renderSummary(plans, options) {
  const matches = plans.filter((plan) => plan.matched);
  const lines = [
    `ClawHub rescan auto-response ${options.dryRun ? "dry run" : "apply run"} for ${options.repo}`,
    `Scanned ${plans.length} issue(s); matched ${matches.length}.`,
  ];
  for (const plan of matches) {
    lines.push(`- #${plan.number}: ${plan.title}`);
    lines.push(`  ${plan.url}`);
    lines.push(`  rules: ${plan.matchedRules.join(", ")}`);
  }
  return lines.join("\n");
}

function helpText() {
  return [
    "Usage: bun scripts/github/clawhub-rescan-auto-response.mjs [options]",
    "",
    "Options:",
    "  --repo <owner/repo>   Repository to inspect. Default: openclaw/clawhub",
    "  --limit <n>           Number of open issues to scan. Default: 100",
    "  --issue <n>           Inspect one issue number. Repeatable.",
    "  --dry-run             Preview only. Default.",
    "  --comment-for-labeled-issue",
    `                        Post guidance only when ${RESCAN_GUIDANCE_LABEL} is already present.`,
    `  --apply               Add the label and guidance comment. Requires ${APPLY_CONFIRM_ENV}=1.`,
    "  --help                Show this help.",
  ].join("\n");
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }
  const issues = await fetchIssues(options);
  const plans = options.commentForLabeledIssue
    ? issues.map((issue) => {
        const classification = planCommentForLabeledIssue(issue);
        return {
          number: issue.number,
          title: issue.title,
          url: issue.url,
          matched: classification.matched,
          matchedRules: classification.matchedRules,
          reason: classification.reason,
          actions: classification.actions,
        };
      })
    : issues.map(planIssue);
  const applyResults = options.dryRun ? [] : plans.map((plan) => applyPlan(plan, options));
  console.error(renderSummary(plans, options));
  console.log(
    JSON.stringify(
      {
        repo: options.repo,
        dryRun: options.dryRun,
        scanned: plans.length,
        matched: plans.filter((plan) => plan.matched).length,
        applied: applyResults.filter((result) => result.applied).length,
        applyResults,
        plans,
      },
      null,
      2,
    ),
  );
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
