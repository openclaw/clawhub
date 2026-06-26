export const APPEALS_URL = "https://appeals.openclaw.ai/";
export const MODERATION_GUIDELINES_URL = "https://docs.openclaw.ai/clawhub/moderation";
export const CLAWHUB_DASHBOARD_URL = "https://clawhub.ai/dashboard";
export const OPENCLAW_DISCORD_URL = "https://discord.gg/clawd";
export const MALICIOUS_REJECTION_ACCOUNT_WARNING =
  "Repeated malicious rejections may lead to account disablement.";
const MAX_EMAIL_FINDING_SUMMARY_LENGTH = 280;
export const ADMIN_ONE_OFF_TEMPLATE = "generic-one-off";

const PUBLISHER_ABUSE_FINDING_SUMMARY =
  "Your account was identified by ClawHub's publisher abuse review workflow for activity that appears inconsistent with our Acceptable Usage policy.";
const PUBLISHER_ABUSE_POLICY_ITEMS = [
  "Bulk or spam publishing of large numbers of low-effort, duplicative, placeholder, or machine-generated listings.",
  "Publishing large catalogs with little or no usage, maintenance, source clarity, or meaningful differentiation.",
  "Artificially inflating installs, downloads, stars, or other engagement metrics.",
  "Abnormal download activity with little or no corresponding install activity.",
];

export type NotificationArtifact = {
  kind: "skill" | "plugin";
  name: string;
};

export type BanNotificationSource = "manual" | "autoban";

export type BanNotificationEmailArgs = {
  handle?: string;
  source: BanNotificationSource;
  reason?: string;
  trigger?: string;
  artifact?: NotificationArtifact;
  bannedAt?: number;
  hiddenArtifacts?: number;
};

export type BanNotificationEmailContext = {
  appealUrl: typeof APPEALS_URL;
  artifact: NotificationArtifact | null;
  scannerLabel: string | null;
  findingSummary: string;
  policyReasonItems: string[];
};

export type TransactionalEmail = {
  subject: string;
  context: BanNotificationEmailContext;
  text: string;
  html: string;
};

export type RestoredAccountEmailArgs = {
  handle?: string;
  restoredListings?: NotificationArtifact[];
  restoredAt?: number;
  skillsRestored?: number;
  packagesRestored?: number;
};

export type MaliciousArtifactEmailArgs = {
  handle?: string;
  artifact: NotificationArtifact;
  version?: string;
  trigger?: string;
  findingSummary?: string;
};

export type PackageInspectorEmailFinding = {
  findingKind: "warning" | "error";
  code: string;
  issueClass?: string;
  level?: string;
  severity?: string;
  message: string;
  authorRemediation?: {
    summary: string;
    docsUrl?: string;
  };
  inspectorVersion?: string;
  targetOpenClawVersion?: string;
  scanSource?: "publish" | "nightly";
};

export type PackageInspectorFindingsEmailArgs = {
  handle?: string;
  packageName: string;
  version: string;
  findings: PackageInspectorEmailFinding[];
};

export type PublisherAbuseWarningScore = {
  modelVersion: string;
  publishedSkills: number;
  totalInstalls: number;
  totalStars: number;
  totalDownloads: number;
  installsPerSkill: number;
  starsPerSkill: number;
  downloadsPerSkill: number;
  zScore: number;
  reasonCodes: string[];
};

export type PublisherAbuseWarningEmailArgs = {
  handle?: string;
  publisherHandle: string;
  warningSentAt?: number;
  deadlineAt: number;
  score: PublisherAbuseWarningScore;
};

export type AdminOneOffEmailArgs = {
  recipientHandle?: string;
  subject: string;
  title?: string;
  body: string;
  primaryActionLabel?: string;
  primaryActionUrl?: string;
};

type BanReasonSummary = {
  scannerLabel: string | null;
  findingSummary: string;
  policyReasonItems?: string[];
};

function normalizeReasonInput(args: Pick<BanNotificationEmailArgs, "reason" | "trigger">) {
  return `${args.reason ?? ""} ${args.trigger ?? ""}`.trim().toLowerCase();
}

function summarizeBanReason(args: BanNotificationEmailArgs): BanReasonSummary {
  const normalized = normalizeReasonInput(args);

  if (/\bpublisher[_\-\s]?abuse\b/.test(normalized)) {
    return {
      scannerLabel: null,
      findingSummary: PUBLISHER_ABUSE_FINDING_SUMMARY,
      policyReasonItems: PUBLISHER_ABUSE_POLICY_ITEMS,
    };
  }

  if (args.source === "autoban") {
    if (normalized.includes("virustotal") || normalized.includes("virus_total")) {
      return {
        scannerLabel: "VirusTotal",
        findingSummary: "VirusTotal telemetry contributed to a malicious upload finding.",
      };
    }
    if (normalized.includes("static")) {
      return {
        scannerLabel: "Static analysis",
        findingSummary: "Static analysis flagged malicious upload patterns.",
      };
    }
    if (
      normalized.includes("clawscan") ||
      normalized.includes("llm") ||
      normalized.includes("malicious")
    ) {
      return {
        scannerLabel: "ClawScan",
        findingSummary: "ClawScan classified the uploaded skill as malicious.",
      };
    }
    return {
      scannerLabel: "ClawHub security checks",
      findingSummary: "ClawHub security checks classified the uploaded skill as malicious.",
    };
  }

  if (/rate[-\s]?limit|publishing automation|automated(?: cli)? publishing/.test(normalized)) {
    return {
      scannerLabel: null,
      findingSummary: "Publishing automation triggered ClawHub rate-limit abuse controls.",
    };
  }

  return {
    scannerLabel: null,
    findingSummary: "ClawHub staff disabled the account after a security review.",
  };
}

function artifactLabel(artifact: NotificationArtifact) {
  return `${artifact.kind === "skill" ? "Skill" : "Plugin"}: ${artifact.name}`;
}

function greeting(handle: string | undefined) {
  return handle?.trim() ? `Hi ${handle.trim()},` : "Hi,";
}

function handleLabel(handle: string | undefined) {
  const normalized = handle?.trim().replace(/^@+/, "");
  return normalized ? `@${normalized}` : "your account";
}

function formatUtcTimestamp(value: number | undefined, fallback: string) {
  if (!Number.isFinite(value)) return fallback;
  return new Date(value as number)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

async function renderAccountSuspendedTemplate(args: {
  handle?: string;
  suspendedAt?: number;
  hiddenArtifacts?: number;
  findingSummary: string;
  policyReasonItems: string[];
  preheader: string;
}) {
  const { renderAccountSuspendedEmail } = await import("./emailRendering");
  const hiddenArtifacts =
    typeof args.hiddenArtifacts === "number" && Number.isFinite(args.hiddenArtifacts)
      ? Math.max(0, Math.trunc(args.hiddenArtifacts))
      : undefined;
  const rendered = await renderAccountSuspendedEmail({
    handle: handleLabel(args.handle),
    suspendedAt: formatUtcTimestamp(args.suspendedAt, "moderation review"),
    ...(hiddenArtifacts === undefined ? {} : { hiddenArtifacts }),
    findingSummary: args.findingSummary,
    policyReasonItems: args.policyReasonItems,
    preheader: args.preheader,
  });
  return rendered.html;
}

async function renderAccountReinstatedTemplate(args: {
  handle?: string;
  restoredAt?: number;
  skillsRestored?: number;
  packagesRestored?: number;
}) {
  const { renderAccountReinstatedEmail } = await import("./emailRendering");
  const hasRestoredCounts =
    typeof args.skillsRestored === "number" && typeof args.packagesRestored === "number";
  const preheader = hasRestoredCounts
    ? `Your account is active again - ${args.skillsRestored} skills and ${args.packagesRestored} packages restored. Note: previous API tokens remain revoked.`
    : "Your account is active again. Note: previous API tokens remain revoked.";
  const rendered = await renderAccountReinstatedEmail({
    handle: handleLabel(args.handle),
    restoredAt: formatUtcTimestamp(args.restoredAt, "account review"),
    ...(hasRestoredCounts
      ? { skillsRestored: args.skillsRestored, packagesRestored: args.packagesRestored }
      : {}),
    preheader,
  });
  return rendered.html;
}

async function renderGenericOneOffTemplate(args: AdminOneOffEmailArgs) {
  const { renderAdminOneOffEmail } = await import("./emailRendering");
  const subject = args.subject.trim();
  const title = args.title?.trim() || subject;
  const actionLabel = args.primaryActionLabel?.trim();
  const actionUrl = args.primaryActionUrl?.trim();
  const rendered = await renderAdminOneOffEmail({
    ...(args.recipientHandle?.trim() ? { recipientHandle: args.recipientHandle.trim() } : {}),
    subject,
    title,
    body: args.body.trim(),
    ...(actionLabel && actionUrl ? { primaryAction: { label: actionLabel, url: actionUrl } } : {}),
  });
  return rendered.html;
}

function buildScanDownloadCommand(args: MaliciousArtifactEmailArgs) {
  const version = args.version?.trim() || "<version>";
  const kindFlag = args.artifact.kind === "plugin" ? " --kind plugin" : "";
  return `clawhub scan download ${args.artifact.name} --version ${version}${kindFlag}`;
}

function buildPluginValidateCommand() {
  return "clawhub package validate <path-to-plugin>";
}

function normalizeEmailFindingSummary(value: string | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= MAX_EMAIL_FINDING_SUMMARY_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_EMAIL_FINDING_SUMMARY_LENGTH - 3).trimEnd()}...`;
}

export async function buildBanNotificationEmail(
  args: BanNotificationEmailArgs,
): Promise<TransactionalEmail> {
  const summary = summarizeBanReason(args);
  const artifact = args.artifact ?? null;
  const policyReasonItems = summary.policyReasonItems ?? [];
  const hiddenArtifacts =
    typeof args.hiddenArtifacts === "number" && Number.isFinite(args.hiddenArtifacts)
      ? Math.max(0, Math.trunc(args.hiddenArtifacts))
      : artifact
        ? 1
        : undefined;
  const context: BanNotificationEmailContext = {
    appealUrl: APPEALS_URL,
    artifact,
    scannerLabel: summary.scannerLabel,
    findingSummary: summary.findingSummary,
    policyReasonItems,
  };

  const lines = [
    greeting(args.handle),
    "",
    "Your ClawHub account has been suspended.",
    `Reason: ${context.findingSummary}`,
  ];
  if (artifact) lines.push(artifactLabel(artifact));
  if (typeof hiddenArtifacts === "number") lines.push(`Artifacts hidden: ${hiddenArtifacts}`);
  if (policyReasonItems.length > 0) {
    lines.push("", "Policy signals:", ...policyReasonItems.map((item) => `- ${item}`));
  }

  lines.push(
    "",
    "What changed:",
    "- Your ClawHub account cannot sign in.",
    "- Existing API tokens for the account have been revoked.",
    "- Published listings owned by the account may be hidden from public view.",
  );
  lines.push("", `Appeal: ${APPEALS_URL}`);

  lines.push("", "ClawHub Security");

  const impactItems = [
    "Your ClawHub account cannot sign in.",
    "Existing API tokens for the account have been revoked.",
    "Published listings owned by the account may be hidden from public view.",
  ];
  const detailLines = [
    context.findingSummary,
    ...policyReasonItems,
    ...(artifact ? [artifact.name] : []),
    ...impactItems,
  ];
  const html = await renderAccountSuspendedTemplate({
    handle: args.handle,
    suspendedAt: args.bannedAt,
    hiddenArtifacts,
    findingSummary: context.findingSummary,
    policyReasonItems,
    preheader: detailLines.join(" "),
  });

  return {
    subject: "Your ClawHub account has been suspended",
    context,
    text: lines.join("\n"),
    html,
  };
}

export async function buildRestoredAccountEmail(args: RestoredAccountEmailArgs) {
  const restoredListings = args.restoredListings ?? [];
  const listingLines = restoredListings.map(artifactLabel);
  const lines = [
    greeting(args.handle),
    "",
    "Your ClawHub account can sign in again.",
    "Previously revoked API tokens stay revoked. Create a new token before using the CLI or API again.",
  ];
  if (listingLines.length > 0) {
    lines.push("", "Restored listings:", ...listingLines);
  }
  lines.push("", "ClawHub Security");

  const skillsRestored = Object.hasOwn(args, "skillsRestored")
    ? args.skillsRestored
    : restoredListings.filter((listing) => listing.kind === "skill").length;
  const packagesRestored = Object.hasOwn(args, "packagesRestored")
    ? args.packagesRestored
    : restoredListings.filter((listing) => listing.kind === "plugin").length;
  const html = await renderAccountReinstatedTemplate({
    handle: args.handle,
    restoredAt: args.restoredAt,
    skillsRestored,
    packagesRestored,
  });

  return {
    subject: "Your ClawHub account has been reinstated",
    text: lines.join("\n"),
    html,
  };
}

export async function buildMaliciousArtifactEmail(args: MaliciousArtifactEmailArgs) {
  const artifactKind = args.artifact.kind === "skill" ? "skill" : "plugin";
  const artifactLabelText = artifactLabel(args.artifact);
  const scanDownloadCommand = buildScanDownloadCommand(args);
  const findingSummary =
    normalizeEmailFindingSummary(args.findingSummary) ??
    (args.trigger?.includes("static") === true
      ? "Static analysis flagged malicious upload patterns."
      : args.trigger?.includes("virustotal") === true || args.trigger?.includes("vt_") === true
        ? "VirusTotal telemetry contributed to a malicious upload finding."
        : "ClawScan classified the uploaded artifact as malicious.");
  const subject = `ClawHub blocked a ${artifactKind} version`;

  const lines = [
    greeting(args.handle),
    "",
    `ClawHub blocked a ${artifactKind} version after a security scan.`,
    `Reason: ${findingSummary}`,
    artifactLabelText,
  ];
  if (args.version?.trim()) lines.push(`Version: ${args.version.trim()}`);
  lines.push(
    "",
    "What changed:",
    "- This version was not made public.",
    "- Your account can still sign in.",
    `- You can upload a fixed version of this ${artifactKind}.`,
    `- ${MALICIOUS_REJECTION_ACCOUNT_WARNING}`,
    "",
    "Download the scan results for the blocked submitted version:",
    scanDownloadCommand,
    `Docs: ${MODERATION_GUIDELINES_URL}`,
    `Increment the version number before uploading the fixed ${artifactKind}.`,
    "",
    "ClawHub Security",
  );

  const { renderBlockedVersionEmail } = await import("./emailRendering");
  const rendered = await renderBlockedVersionEmail({
    artifactKind,
    artifactName: args.artifact.name,
    version: args.version?.trim() || "<version>",
    findingSummary,
    validateCommand: scanDownloadCommand,
    docsUrl: MODERATION_GUIDELINES_URL,
    preheader: `${artifactLabelText} was blocked by ClawHub security scans.`,
  });

  return {
    subject,
    text: lines.join("\n"),
    html: rendered.html,
  };
}

export async function buildPackageInspectorFindingsEmail(args: PackageInspectorFindingsEmailArgs) {
  const targetOpenClawVersion = args.findings.find(
    (finding) => finding.targetOpenClawVersion,
  )?.targetOpenClawVersion;
  const validateCommand = buildPluginValidateCommand();
  const subject = `Plugin Inspector findings for ${args.packageName}@${args.version}`;
  const findingCount = args.findings.length;
  const intro = `We found ${findingCount} ${findingCount === 1 ? "issue" : "issues"} with version ${args.version} of ${args.packageName}.`;
  const nextSteps = [
    "Address the findings below in your plugin package.",
    "Run the validation command locally against your changes.",
    "When validation passes, upload a new version.",
  ];
  const findingLines = formatPackageInspectorFindingsText(args.findings);
  const metadataLines = [
    `Plugin: ${args.packageName}@${args.version}`,
    targetOpenClawVersion ? `OpenClaw Version: ${targetOpenClawVersion}` : null,
  ].filter((line): line is string => line !== null);
  const lines = [
    greeting(args.handle),
    "",
    intro,
    "",
    ...metadataLines,
    "",
    "Next steps:",
    ...nextSteps.map((item) => `- ${item}`),
    "",
    "Findings:",
    ...findingLines,
    "",
    "Validate a local fix:",
    validateCommand,
  ];

  const { renderPluginInspectorFindingsEmail } = await import("./emailRendering");
  const rendered = await renderPluginInspectorFindingsEmail({
    packageName: args.packageName,
    version: args.version,
    ...(targetOpenClawVersion ? { openClawVersion: targetOpenClawVersion } : {}),
    findings: args.findings.map((finding) => ({
      code: finding.code,
      kind: finding.findingKind,
      meta: [finding.code, finding.issueClass, finding.severity].filter(Boolean).join(" · "),
      message: finding.message,
      ...(finding.authorRemediation?.summary ? { fix: finding.authorRemediation.summary } : {}),
      ...(finding.authorRemediation?.docsUrl ? { docsUrl: finding.authorRemediation.docsUrl } : {}),
    })),
    validateCommand,
    preheader: intro,
  });

  return {
    subject,
    text: lines.join("\n"),
    html: rendered.html,
  };
}

export async function buildPublisherAbuseWarningEmail(args: PublisherAbuseWarningEmailArgs) {
  const publisherHandle = args.publisherHandle.trim().replace(/^@+/, "");
  const publisherLabel = publisherHandle ? `@${publisherHandle}` : "your publisher";
  const deadline = formatUtcTimestamp(args.deadlineAt, "the warning deadline");
  const warningSentAt = formatUtcTimestamp(args.warningSentAt, "this warning");
  const body = [
    `ClawHub's publisher abuse detection flagged the publisher profile ${publisherLabel}.`,
    "",
    "If this is not resolved before the deadline below, the account linked to this publisher may be suspended the next time the weekly abuse scan confirms the same issue.",
    "",
    `Warning sent: ${warningSentAt}`,
    `Deadline: ${deadline}`,
    "",
    "What to fix:",
    "- Delete low-quality, duplicate, placeholder, or machine-generated listings.",
    "- Consolidate near-identical skills or plugins.",
    "- Keep only listings that are useful, maintained, and meaningfully different.",
    "- Do not inflate installs, downloads, stars, or other engagement metrics.",
    "",
    `For more information, join the OpenClaw Discord and tag one of the maintainers: ${OPENCLAW_DISCORD_URL}`,
  ].join("\n");
  const subject = "Action required: ClawHub publisher abuse warning";

  const html = await renderGenericOneOffTemplate({
    recipientHandle: handleLabel(args.handle),
    subject,
    title: "Action required: publisher abuse warning",
    body,
    primaryActionLabel: "Open ClawHub dashboard",
    primaryActionUrl: CLAWHUB_DASHBOARD_URL,
  });

  return {
    subject,
    text: [
      greeting(args.handle),
      "",
      body,
      "",
      `Open ClawHub dashboard: ${CLAWHUB_DASHBOARD_URL}`,
      "",
      "ClawHub Security",
    ].join("\n"),
    html,
  };
}

export async function buildAdminOneOffEmail(args: AdminOneOffEmailArgs) {
  const title = args.title?.trim() || args.subject.trim();
  const lines = [title, "", args.body.trim()];
  if (args.primaryActionLabel?.trim() && args.primaryActionUrl?.trim()) {
    lines.push("", `${args.primaryActionLabel.trim()}: ${args.primaryActionUrl.trim()}`);
  }
  lines.push("", "ClawHub Team");

  const html = await renderGenericOneOffTemplate(args);

  return {
    subject: args.subject.trim(),
    text: lines.join("\n"),
    html,
  };
}

function formatPackageInspectorFindingsText(findings: PackageInspectorEmailFinding[]) {
  if (findings.length === 0) return ["- No findings were included."];
  return findings.flatMap((finding) => {
    const lines = [
      `- **${finding.findingKind.toUpperCase()}** \`${finding.code}\`${formatFindingMetaText(finding)}`,
      `  ${finding.message}`,
    ];
    if (finding.authorRemediation?.summary) {
      lines.push("  Fix:");
      lines.push(`  ${finding.authorRemediation.summary}`);
      if (finding.authorRemediation.docsUrl) {
        lines.push("  Docs:");
        lines.push(`  ${finding.authorRemediation.docsUrl}`);
      }
    }
    return lines;
  });
}

function formatFindingMetaText(finding: PackageInspectorEmailFinding) {
  const meta = [finding.issueClass, finding.severity].filter(Boolean).join(", ");
  return meta ? ` (${meta})` : "";
}
