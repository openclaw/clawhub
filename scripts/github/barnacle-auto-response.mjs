// Barnacle owns deterministic GitHub triage and auto-response behavior.
import { classifyRescanRequest, RESCAN_GUIDANCE_LABEL } from "./clawhub-rescan-auto-response.mjs";

export const activePrLimit = 10;

export const rules = [
  {
    label: "r: support",
    close: true,
    message:
      "Please use the OpenClaw community support server for this: https://discord.gg/clawd. If this is a concrete ClawHub bug, reopen with the ClawHub URL, account/owner handle, expected behavior, and current result.",
  },
  {
    label: "r: openclaw-core",
    close: true,
    message:
      "This belongs in the OpenClaw core repo, not ClawHub. Please file it at https://github.com/openclaw/openclaw/issues with fresh reproduction steps.",
  },
  {
    label: "r: paid-skill",
    close: true,
    message:
      "ClawHub does not support paid skills, per-skill pricing, paywalls, or revenue sharing. Closing this as outside the current product scope.",
  },
  {
    label: "r: direct-skill-content",
    close: true,
    message:
      "Skills should be published through ClawHub, not added directly to this repo. Use the ClawHub CLI or web upload flow so the package goes through normal validation, scanning, and ownership checks.",
  },
  {
    label: "r: third-party-skill-issue",
    close: true,
    message:
      "Thanks for reporting this. This looks specific to a third-party skill's behavior, content, or maintenance, which is controlled by the skill publisher rather than ClawHub. Please contact the publisher, fork/copy the skill and adapt it for your own use, or publish a fixed version through ClawHub.",
  },
  {
    label: "r: too-many-prs",
    close: true,
    message:
      `Closing this PR because the author has more than ${activePrLimit} active PRs in this repo. ` +
      "Please reduce the active PR queue and reopen or resubmit once it is back under the limit.",
  },
];

export const managedLabelSpecs = {
  "r: support": {
    color: "0E8A16",
    description: "Auto-close: support requests belong in Discord or support docs.",
  },
  "r: openclaw-core": {
    color: "5319E7",
    description: "Auto-close: OpenClaw runtime/core issues belong in openclaw/openclaw.",
  },
  "r: paid-skill": {
    color: "D93F0B",
    description: "Auto-close: paid skills/revenue requests are outside ClawHub scope.",
  },
  "r: direct-skill-content": {
    color: "D93F0B",
    description: "Auto-close: skill content must be published through ClawHub, not PR'd.",
  },
  "r: third-party-skill-issue": {
    color: "D93F0B",
    description: "Auto-close: issue belongs to the third-party skill publisher or a user fork.",
  },
  [RESCAN_GUIDANCE_LABEL]: {
    color: "BFDADC",
    description: "Guides owners to the ClawHub rescan flow for review requests.",
  },
  "r: too-many-prs": {
    color: "D93F0B",
    description: "Auto-close: author has more than ten active PRs.",
  },
  "r: too-many-prs-override": {
    color: "C2E0C6",
    description: "Maintainer override for the active-PR limit auto-close.",
  },
  dirty: {
    color: "B60205",
    description: "Maintainer-applied auto-close for dirty/unrelated PR branches.",
  },
  "r: spam": {
    color: "B60205",
    description: "Auto-close and lock spam.",
  },
  "bad-barnacle": {
    color: "E99695",
    description: "Suppress Barnacle automation on this issue or PR.",
  },
  "trigger-response": {
    color: "FBCA04",
    description: "Maintainer trigger to rerun Barnacle auto-response on an item.",
  },
  "triage: blank-template": {
    color: "C5DEF5",
    description: "Candidate: PR template appears mostly untouched.",
  },
  "triage: low-signal-docs": {
    color: "C5DEF5",
    description: "Candidate: docs-only change looks low signal; maintainer review needed.",
  },
  "triage: test-only-no-bug": {
    color: "C5DEF5",
    description: "Candidate: test-only change has no linked bug or behavior evidence.",
  },
  "triage: refactor-only": {
    color: "C5DEF5",
    description: "Candidate: refactor/cleanup-only PR without maintainer context.",
  },
  "triage: risky-infra": {
    color: "C5DEF5",
    description: "Candidate: infra/CI/release change needs maintainer review.",
  },
  "triage: dirty-candidate": {
    color: "C5DEF5",
    description: "Candidate: broad unrelated surfaces; may need splitting or cleanup.",
  },
  "triage: direct-skill-content": {
    color: "C5DEF5",
    description: "Candidate: skill/package content appears to bypass ClawHub publishing.",
  },
};

export const candidateLabels = {
  blankTemplate: "triage: blank-template",
  lowSignalDocs: "triage: low-signal-docs",
  testOnlyNoBug: "triage: test-only-no-bug",
  refactorOnly: "triage: refactor-only",
  riskyInfra: "triage: risky-infra",
  dirtyCandidate: "triage: dirty-candidate",
  directSkillContent: "triage: direct-skill-content",
};

const triggerLabel = "trigger-response";
const invalidLabel = "invalid";
const spamLabel = "r: spam";
const dirtyLabel = "dirty";
const badBarnacleLabel = "bad-barnacle";
const maintainerAuthorLabel = "maintainer";
const activePrLimitLabel = "r: too-many-prs";
const activePrLimitOverrideLabel = "r: too-many-prs-override";
const candidateLabelValues = Object.values(candidateLabels);
const maintainerTeam = "maintainer";
const mentionRegex = /@([A-Za-z0-9-]+)/g;
const pingWarningMessage =
  "Please don't spam-ping multiple maintainers at once. Be patient, or use the OpenClaw community Discord for help: https://discord.gg/clawd";
const noisyPrMessage =
  "Closing this PR because it looks dirty: too many unrelated or unexpected changes. Please recreate it from a clean branch with a narrower diff.";

const candidateActionRules = [
  {
    label: candidateLabels.directSkillContent,
    close: true,
    message: rules.find((rule) => rule.label === "r: direct-skill-content").message,
  },
  {
    label: candidateLabels.dirtyCandidate,
    close: true,
    message: noisyPrMessage,
  },
  {
    label: candidateLabels.riskyInfra,
    close: true,
    message:
      "Closing this PR because it changes infra/CI/release/ops plumbing without maintainer context and validation. Open an issue/RFC or get owner approval before sending a patch.",
  },
  {
    label: candidateLabels.lowSignalDocs,
    close: true,
    message:
      "Closing this PR because the docs-only change is too low-signal for this repo. Please reopen or resubmit with a concrete ClawHub docs gap and linked context.",
  },
  {
    label: candidateLabels.testOnlyNoBug,
    close: true,
    message:
      "Closing this PR because it only changes tests without a linked bug, owner request, or behavior change. Test-only PRs need a concrete regression or maintainer-requested gap.",
  },
  {
    label: candidateLabels.refactorOnly,
    close: true,
    message:
      "Closing this PR because it is refactor/cleanup-only without maintainer context. We avoid churn unless it unlocks a concrete fix, architecture change, or owned cleanup.",
  },
  {
    label: candidateLabels.blankTemplate,
    close: true,
    message:
      "Closing this PR because the template is mostly blank and does not describe a concrete ClawHub problem, fix, or test plan. Please reopen or resubmit with the missing context filled in.",
  },
];

function normalizeLogin(login) {
  return String(login ?? "").toLowerCase();
}

export function hasLinkedReference(text) {
  return /(?:#\d+|github\.com\/openclaw\/clawhub\/(?:issues|pull)\/\d+)/i.test(text);
}

export function hasFilledTemplateLine(body, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*-\\s*${escapedField}:\\s*\\S`, "im").test(body);
}

export function hasMostlyBlankTemplate(body) {
  if (!body) {
    return true;
  }
  const emptyFields = [
    "Problem",
    "Why it matters",
    "What changed",
    "What did NOT change",
    "Root cause",
    "Target test or file",
  ].filter((field) => {
    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*-\\s*${escapedField}(?: \\([^)]*\\))?:\\s*$`, "im").test(body);
  }).length;
  const hasTemplateIntro = body.includes("Describe the problem and fix in 2");
  const emptyClosingRef = /^\s*-\s*(?:Closes|Related)\s+#\s*$/im.test(body);
  return hasTemplateIntro && emptyFields >= 3 && emptyClosingRef;
}

function stripPullRequestTemplateBoilerplate(text) {
  return text
    .replace(/^#{2,3}\s+.*$/gm, "")
    .replace(/^-\s*\[[ xX]\]\s+.*$/gm, "")
    .replace(/^-\s*(?:Closes|Related)\s+#\s*$/gim, "")
    .replace(
      /^-\s*(?:Problem|Why it matters|What changed|What did NOT change|Root cause|Target test or file|Risk|Mitigation):\s*$/gim,
      "",
    )
    .replace(/Describe the problem and fix in 2(?:-|–)5 bullets:/g, "");
}

function issueText(issue) {
  return `${issue.title ?? ""}\n${issue.body ?? ""}`.trim();
}

export function isSkillSubmissionIssue(issue) {
  const text = issueText(issue);
  return (
    /\bcan\s+this\s+skill\s+be\s+added\b/i.test(text) ||
    (/\b(?:project|repository|repo)\s+url\s*:/i.test(text) &&
      /\b(?:skill|skills|agent\s+skill|skill\s+pack)\b/i.test(text) &&
      /\b(?:give\s+it\s+a\s+try|star\s+(?:the\s+)?repo|please\s+add|add\s+(?:this\s+)?skill|include\s+(?:this\s+)?skill|submit(?:ting)?\s+(?:a\s+)?skill)\b/i.test(
        text,
      ))
  );
}

export function isSecurityReportIssue(issue) {
  const text = issueText(issue);
  const hasSecretSignal =
    /\b(?:credential|credentials|secret|token|api\s*key|bearer|password|mnemonic|service[-\s]?role|private\s+key|plaintext)\b/i.test(
      text,
    );
  const hasExposureSignal =
    /\b(?:leak|expos(?:e|ed|es|ure)|commit(?:ted)?|hardcod(?:e|ed|es|ing)|plaintext|steal|exfiltrat(?:e|es|ed|ing|ion)|post(?:s|ed|ing)?|send(?:s|ing)?|sent|upload(?:s|ed|ing)?|transmit(?:s|ted|ting)?|argv|process\s+env)\b/i.test(
      text,
    );
  return /\bsecurity\b/i.test(issue.title ?? "") || (hasSecretSignal && hasExposureSignal);
}

export function hasConcreteBehaviorContext(body, text) {
  if (hasLinkedReference(text)) {
    return true;
  }
  if (
    hasFilledTemplateLine(body, "Problem") &&
    hasFilledTemplateLine(body, "Why it matters") &&
    hasFilledTemplateLine(body, "What changed")
  ) {
    return true;
  }
  const signalText = stripPullRequestTemplateBoilerplate(text);
  return /\b(repro|regression|root cause|crash|bug|failure|failing|broken|behavior|scenario|fixes?)\b/i.test(
    signalText,
  );
}

export function hasClearDesignContext(body, text) {
  if (hasConcreteBehaviorContext(body, text)) {
    return true;
  }
  const signalText = stripPullRequestTemplateBoilerplate(text);
  return /\b(rfc|design|architecture|migration|maintainer request|owner request|requested by maintainer|approved by maintainer|launch blocker|beta blocker)\b/i.test(
    signalText,
  );
}

export function isMarkdownOrDocsFile(filename) {
  return (
    filename.startsWith("docs/") ||
    /\.mdx?$/i.test(filename) ||
    /(^|\/)(README|CHANGELOG|CONTRIBUTING|AGENTS|CLAUDE)\.md$/i.test(filename)
  );
}

export function isTestLikeFile(filename) {
  return (
    /(^|\/)(__tests__|fixtures?|snapshots?)(\/|$)/i.test(filename) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(filename) ||
    /\.(?:snap|snapshot)$/i.test(filename)
  );
}

export function isInfraLikeFile(filename) {
  return (
    /^\.github\/(?:workflows|actions)\//.test(filename) ||
    filename.startsWith("scripts/") ||
    /^Dockerfile(?:\.|$)/.test(filename) ||
    filename.startsWith("docker/") ||
    /(^|\/)(?:package\.json|bun\.lockb?|bun\.lock|actionlint\.yaml|dependabot\.yml)$/i.test(
      filename,
    ) ||
    /\brelease\b/i.test(filename)
  );
}

export function isDirectSkillContentFile(filename) {
  if (filename.startsWith(".agents/skills/")) {
    return false;
  }
  return (
    filename.startsWith("skills/") ||
    filename.startsWith("seed/skills/") ||
    filename.startsWith("seeds/skills/") ||
    filename.startsWith("public/skills/")
  );
}

export function surfacesForFile(filename) {
  if (filename.startsWith("src/")) return ["src"];
  if (filename.startsWith("convex/")) return ["convex"];
  if (filename.startsWith("server/")) return ["server"];
  if (filename.startsWith("packages/")) return ["packages"];
  if (filename.startsWith(".github/")) return [".github"];
  if (filename.startsWith("docs/") || /\.mdx?$/i.test(filename)) return ["docs"];
  if (filename.startsWith("scripts/")) return ["scripts"];
  return ["other"];
}

export function classifyPullRequestCandidateLabels(pullRequest, files) {
  if (files.length === 0) {
    return [];
  }

  const filenames = files.map((file) => file.filename);
  const body = pullRequest.body ?? "";
  const text = `${pullRequest.title ?? ""}\n${body}`;
  const signalText = stripPullRequestTemplateBoilerplate(text);
  const linkedReference = hasLinkedReference(text);
  const blankTemplate = hasMostlyBlankTemplate(body);
  const concreteBehaviorContext = blankTemplate
    ? linkedReference
    : hasConcreteBehaviorContext(body, text);
  const clearDesignContext = blankTemplate ? linkedReference : hasClearDesignContext(body, text);
  const labelsToAdd = [];

  if (blankTemplate) {
    labelsToAdd.push(candidateLabels.blankTemplate);
  }

  const docsOnly = filenames.every(isMarkdownOrDocsFile);
  const docsSignal =
    /\b(add|adds|update|updates|fix|fixes|improve|cleanup|clean up|typo|readme|docs?|documentation|translation|translate)\b/i.test(
      text,
    );
  if (docsOnly && !linkedReference && (blankTemplate || docsSignal)) {
    labelsToAdd.push(candidateLabels.lowSignalDocs);
  }

  const testOnly = filenames.every(isTestLikeFile);
  const lowSignalTestTitle =
    /\b(add|adds|added|improve|increase|boost|expand|fix|stabilize|update)\b.*\b(test|tests|coverage|flaky|flake|snapshot|fixtures?)\b/i.test(
      pullRequest.title ?? "",
    ) ||
    /\b(test|tests|coverage|flaky|flake)\b.*\b(add|increase|improve|fix|update|stabilize)\b/i.test(
      pullRequest.title ?? "",
    );
  if (testOnly && !linkedReference && !concreteBehaviorContext && lowSignalTestTitle) {
    labelsToAdd.push(candidateLabels.testOnlyNoBug);
  }

  if (
    !linkedReference &&
    !concreteBehaviorContext &&
    /\b(refactor|cleanup|clean up|rename|formatting|style-only|style only)\b/i.test(signalText)
  ) {
    labelsToAdd.push(candidateLabels.refactorOnly);
  }

  if (filenames.every(isInfraLikeFile) && !linkedReference && !clearDesignContext) {
    labelsToAdd.push(candidateLabels.riskyInfra);
  }

  if (filenames.some(isDirectSkillContentFile) && !clearDesignContext) {
    labelsToAdd.push(candidateLabels.directSkillContent);
  }

  const surfaces = new Set(filenames.flatMap(surfacesForFile));
  if (surfaces.size >= 4 && !clearDesignContext) {
    labelsToAdd.push(candidateLabels.dirtyCandidate);
  }

  return [...new Set(labelsToAdd)];
}

async function ensureLabelSynced(github, context, name, color, description) {
  try {
    const current = await github.rest.issues.getLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      name,
    });
    const currentDescription = current.data.description ?? "";
    if (
      current.data.color.toLowerCase() !== color.toLowerCase() ||
      currentDescription !== description
    ) {
      await github.rest.issues.updateLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        name,
        color,
        description,
      });
    }
  } catch (error) {
    if (error?.status !== 404) {
      throw error;
    }
    await github.rest.issues.createLabel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      name,
      color,
      description,
    });
  }
}

async function syncManagedLabels(github, context) {
  for (const [name, spec] of Object.entries(managedLabelSpecs)) {
    await ensureLabelSynced(github, context, name, spec.color, spec.description);
  }
}

function createMaintainerChecker(github, context) {
  const maintainerCache = new Map();
  return async (login) => {
    if (!login) {
      return false;
    }
    const normalized = normalizeLogin(login);
    if (maintainerCache.has(normalized)) {
      return maintainerCache.get(normalized);
    }
    let isMember = false;
    try {
      const membership = await github.rest.teams.getMembershipForUserInOrg({
        org: context.repo.owner,
        team_slug: maintainerTeam,
        username: normalized,
      });
      isMember = membership?.data?.state === "active";
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }
    maintainerCache.set(normalized, isMember);
    return isMember;
  };
}

async function isPrivilegedPullRequestAuthor(github, context, pullRequest, labelSet, isMaintainer) {
  const authorLogin = pullRequest.user?.login ?? "";
  if (labelSet.has(maintainerAuthorLabel) || pullRequest.author_association === "OWNER") {
    return true;
  }
  if (authorLogin && (await isMaintainer(authorLogin))) {
    return true;
  }

  try {
    const permission = await github.rest.repos.getCollaboratorPermissionLevel({
      owner: context.repo.owner,
      repo: context.repo.repo,
      username: authorLogin,
    });
    const roleName = (permission?.data?.role_name ?? "").toLowerCase();
    return roleName === "admin" || roleName === "maintain";
  } catch (error) {
    if (error?.status !== 404) {
      throw error;
    }
  }

  return false;
}

async function countMaintainerMentions(body, authorLogin, isMaintainer, owner) {
  if (!body) {
    return 0;
  }
  const normalizedAuthor = authorLogin ? normalizeLogin(authorLogin) : "";
  if (normalizedAuthor && (await isMaintainer(normalizedAuthor))) {
    return 0;
  }

  const haystack = body.toLowerCase();
  const teamMention = `@${owner.toLowerCase()}/${maintainerTeam}`;
  if (haystack.includes(teamMention)) {
    return 3;
  }

  const mentions = new Set();
  for (const match of body.matchAll(mentionRegex)) {
    mentions.add(normalizeLogin(match[1]));
  }
  if (normalizedAuthor) {
    mentions.delete(normalizedAuthor);
  }

  let count = 0;
  for (const login of mentions) {
    if (await isMaintainer(login)) {
      count += 1;
    }
  }
  return count;
}

async function addMissingLabels(github, context, core, issueNumber, labels, labelSet) {
  const missingLabels = labels.filter((label) => !labelSet.has(label));
  if (missingLabels.length === 0) {
    return;
  }
  await github.rest.issues.addLabels({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: issueNumber,
    labels: missingLabels,
  });
  for (const label of missingLabels) {
    labelSet.add(label);
  }
  core.info(`Added candidate labels to #${issueNumber}: ${missingLabels.join(", ")}`);
}

async function applyPullRequestCandidateLabels(github, context, core, pullRequest, labelSet) {
  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: pullRequest.number,
    per_page: 100,
  });
  await addMissingLabels(
    github,
    context,
    core,
    pullRequest.number,
    classifyPullRequestCandidateLabels(pullRequest, files),
    labelSet,
  );
}

async function applyIssueCandidateLabels(github, context, core, issue, labelSet) {
  const labelsToAdd = [];

  if (isSkillSubmissionIssue(issue)) {
    labelsToAdd.push("r: direct-skill-content");
  }

  if (
    classifyRescanRequest({
      ...issue,
      labels: [...labelSet].map((name) => ({ name })),
      state: issue.state ?? "OPEN",
    }).matched
  ) {
    labelsToAdd.push(RESCAN_GUIDANCE_LABEL);
  }

  if (isSecurityReportIssue(issue) && !labelSet.has("security")) {
    labelsToAdd.push("security");
  }

  await addMissingLabels(github, context, core, issue.number, labelsToAdd, labelSet);
}

function isAutomationActor(context) {
  const sender = context.payload.sender;
  const login = sender?.login ?? context.actor ?? "";
  return sender?.type === "Bot" || /\[bot\]$/i.test(login);
}

function candidateActionRuleForLabelSet(labelSet, preferredLabel = "") {
  const preferredRule = candidateActionRules.find(
    (rule) => rule.label === preferredLabel && labelSet.has(rule.label),
  );
  if (preferredRule) {
    return preferredRule;
  }
  return candidateActionRules.find((rule) => labelSet.has(rule.label));
}

async function applyPullRequestCandidateAction({
  github,
  context,
  pullRequest,
  labelSet,
  hasTriggerLabel,
  isLabelEvent,
}) {
  if (isAutomationActor(context)) {
    return false;
  }

  const eventLabel = context.payload.label?.name ?? "";
  const isCandidateLabelEvent = isLabelEvent && candidateLabelValues.includes(eventLabel);
  if (!hasTriggerLabel && !isCandidateLabelEvent) {
    return false;
  }

  const rule = candidateActionRuleForLabelSet(
    labelSet,
    isCandidateLabelEvent ? eventLabel : undefined,
  );
  if (!rule) {
    return false;
  }

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pullRequest.number,
    body: rule.message,
  });

  if (rule.close) {
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pullRequest.number,
      state: "closed",
    });
  }

  return true;
}

async function removeLabels(github, context, issueNumber, labels, labelSet) {
  for (const label of labels) {
    if (!labelSet.has(label)) {
      continue;
    }
    try {
      await github.rest.issues.removeLabel({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: issueNumber,
        name: label,
      });
      labelSet.delete(label);
    } catch (error) {
      if (error?.status !== 404) {
        throw error;
      }
    }
  }
}

function labelSetForTarget(target) {
  return new Set(
    (target.labels ?? [])
      .map((label) => (typeof label === "string" ? label : label?.name))
      .filter((name) => typeof name === "string"),
  );
}

async function maybeWarnOnMaintainerPings({ github, context, isMaintainer, target, body, author }) {
  const mentionCount = await countMaintainerMentions(
    body,
    author,
    isMaintainer,
    context.repo.owner,
  );
  if (mentionCount < 3) {
    return;
  }
  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: target.number,
    body: pingWarningMessage,
  });
}

export async function runBarnacleAutoResponse({ github, context, core = console }) {
  const target = context.payload.issue ?? context.payload.pull_request;
  if (!target) {
    return;
  }

  const labelSet = labelSetForTarget(target);
  const issue = context.payload.issue;
  const pullRequest = context.payload.pull_request;
  const comment = context.payload.comment;
  const isMaintainer = createMaintainerChecker(github, context);

  if (comment) {
    if (comment.user?.type === "Bot" || /\[bot\]$/i.test(comment.user?.login ?? "")) {
      return;
    }
    await maybeWarnOnMaintainerPings({
      github,
      context,
      isMaintainer,
      target,
      body: comment.body ?? "",
      author: comment.user?.login ?? "",
    });
    return;
  }

  if (issue && (context.payload.action === "opened" || context.payload.action === "edited")) {
    await maybeWarnOnMaintainerPings({
      github,
      context,
      isMaintainer,
      target: issue,
      body: `${issue.title ?? ""}\n${issue.body ?? ""}`,
      author: issue.user?.login ?? "",
    });
  }

  const hasTriggerLabel = labelSet.has(triggerLabel);
  if (hasTriggerLabel) {
    await removeLabels(github, context, target.number, [triggerLabel], labelSet);
  }

  const isLabelEvent = context.payload.action === "labeled";
  const isPrCandidateEvent =
    pullRequest &&
    ["opened", "edited", "synchronize", "reopened", "labeled"].includes(context.payload.action);
  const isIssueCandidateEvent =
    issue && ["opened", "edited", "reopened", "labeled"].includes(context.payload.action);

  if (labelSet.has(badBarnacleLabel)) {
    core.info(
      `Skipping auto-response checks for #${target.number} because ${badBarnacleLabel} is present.`,
    );
    return;
  }

  if (!hasTriggerLabel && !isLabelEvent && !isPrCandidateEvent && !isIssueCandidateEvent) {
    return;
  }

  await syncManagedLabels(github, context);

  if (issue && isIssueCandidateEvent) {
    await applyIssueCandidateLabels(github, context, core, issue, labelSet);
  }

  if (pullRequest) {
    const isMaintainerAuthoredPullRequest = await isPrivilegedPullRequestAuthor(
      github,
      context,
      pullRequest,
      labelSet,
      isMaintainer,
    );
    if (isMaintainerAuthoredPullRequest) {
      await removeLabels(github, context, pullRequest.number, candidateLabelValues, labelSet);
      await removeLabels(github, context, pullRequest.number, [activePrLimitLabel], labelSet);
      core.info(
        `Skipping Barnacle candidate labels for maintainer-authored PR #${pullRequest.number}.`,
      );
    } else {
      await applyPullRequestCandidateLabels(github, context, core, pullRequest, labelSet);
    }

    if (labelSet.has(dirtyLabel)) {
      await github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
        body: noisyPrMessage,
      });
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
        state: "closed",
      });
      return;
    }

    if (labelSet.has(spamLabel)) {
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
        state: "closed",
      });
      await github.rest.issues.lock({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
        lock_reason: "spam",
      });
      return;
    }

    if (labelSet.has(invalidLabel)) {
      await github.rest.issues.update({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pullRequest.number,
        state: "closed",
      });
      return;
    }

    const handledCandidateAction = await applyPullRequestCandidateAction({
      github,
      context,
      pullRequest,
      labelSet,
      hasTriggerLabel,
      isLabelEvent,
    });
    if (handledCandidateAction) {
      return;
    }

    if (labelSet.has(activePrLimitOverrideLabel)) {
      labelSet.delete(activePrLimitLabel);
    }
  }

  if (issue && labelSet.has(spamLabel)) {
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue.number,
      state: "closed",
      state_reason: "not_planned",
    });
    await github.rest.issues.lock({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue.number,
      lock_reason: "spam",
    });
    return;
  }

  if (issue && labelSet.has(invalidLabel)) {
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: issue.number,
      state: "closed",
      state_reason: "not_planned",
    });
    return;
  }

  const rule = rules.find((item) => labelSet.has(item.label));
  if (!rule) {
    return;
  }

  await github.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: target.number,
    body: rule.message,
  });

  if (rule.close) {
    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: target.number,
      state: "closed",
      ...(issue ? { state_reason: "not_planned" } : {}),
    });
  }
}
