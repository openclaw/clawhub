import { clawhubEmailTemplateSources } from "./clawhubEmailTemplateSources";

export const APPEALS_URL = "https://appeals.openclaw.ai/";
export const MODERATION_GUIDELINES_URL = "https://docs.openclaw.ai/clawhub/moderation";
export const MALICIOUS_REJECTION_ACCOUNT_WARNING =
  "Repeated malicious rejections may lead to account disablement.";
const MAX_EMAIL_FINDING_SUMMARY_LENGTH = 280;
export const ADMIN_ONE_OFF_TEMPLATE = "generic-one-off";
const CLAWHUB_URL = "https://clawhub.ai";

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
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeReasonInput(args: Pick<BanNotificationEmailArgs, "reason" | "trigger">) {
  return `${args.reason ?? ""} ${args.trigger ?? ""}`.trim().toLowerCase();
}

function summarizeBanReason(args: BanNotificationEmailArgs): BanReasonSummary {
  const normalized = normalizeReasonInput(args);

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

function replaceAll(value: string, replacements: Array<[string | RegExp, string]>) {
  return replacements.reduce((html, [pattern, replacement]) => {
    if (typeof pattern === "string") return html.split(pattern).join(replacement);
    return html.replace(pattern, replacement);
  }, value);
}

function formatUtcTimestamp(value: number | undefined, fallback: string) {
  if (!Number.isFinite(value)) return fallback;
  return new Date(value as number)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

function plainTextToTemplateHtml(value: string) {
  return escapeHtml(value.trim()).replaceAll("\n", "<br>");
}

function normalizeFooter(html: string) {
  return html
    .replace(
      /<p style="[^"]*font-size:12px;[^"]*color:#5c5c60;">\s*You received this email because[\s\S]*?<\/p>\n?/g,
      "",
    )
    .replace(
      /<p style="[^"]*font-size:12px;[^"]*color:#5c5c60;">\s*You(?:&#39;|')re receiving this because[\s\S]*?<\/p>\n?/g,
      "",
    )
    .replace(
      /<a href="https:\/\/clawhub\.ai" style="color:#8a8a8e; text-decoration:none;">ClawHub<\/a>\n\s*&nbsp;·&nbsp;\n\s*<a href="https:\/\/clawhub\.ai\/settings" style="color:#8a8a8e; text-decoration:none;">Email preferences<\/a>/g,
      '<a href="https://clawhub.ai" style="color:#8a8a8e; text-decoration:none;">ClawHub</a>\n                  &nbsp;·&nbsp;\n                  <a href="https://clawhub.ai/docs" style="color:#8a8a8e; text-decoration:none;">Docs</a>\n                  &nbsp;·&nbsp;\n                  <a href="https://clawhub.ai/settings" style="color:#8a8a8e; text-decoration:none;">Email preferences</a>',
    )
    .replace(
      /(<a href="https:\/\/(?:clawhub\.ai(?:\/(?:docs|settings))?|docs\.openclaw\.ai)"(?: target="_blank")? style="color:#8a8a8e;\s*)text-decoration:none/g,
      "$1text-decoration:underline",
    );
}

function renderAccountSuspendedTemplate(args: {
  handle?: string;
  suspendedAt?: number;
  hiddenArtifacts?: number;
  preheader: string;
}) {
  const handle = handleLabel(args.handle);
  const suspendedAt = formatUtcTimestamp(args.suspendedAt, "moderation review");
  const hiddenArtifacts =
    typeof args.hiddenArtifacts === "number" && Number.isFinite(args.hiddenArtifacts)
      ? Math.max(0, Math.trunc(args.hiddenArtifacts))
      : undefined;
  const replacements: Array<[string | RegExp, string]> = [
    [
      "Your account has been suspended. Login is blocked, API tokens were revoked, and published artifacts were hidden.",
      escapeHtml(args.preheader),
    ],
    ["@octocat", escapeHtml(handle)],
    ["2025-02-12 14:32 UTC", escapeHtml(suspendedAt)],
    ["https://appeals.openclaw.ai", APPEALS_URL],
  ];
  if (hiddenArtifacts === undefined) {
    replacements.push([
      /\n<tr>\n<td style="padding:14px 18px;border-bottom:1px solid #26262a;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#8a8a8e;">Artifacts hidden<\/td>\n<td align="right" style="padding:14px 18px;border-bottom:1px solid #26262a;font-family:'Courier New',monospace;font-size:14px;color:#f5f5f5;">14<\/td>\n<\/tr>/,
      "",
    ]);
  } else {
    replacements.push([">14<", `>${escapeHtml(String(hiddenArtifacts))}<`]);
  }
  return normalizeFooter(
    replaceAll(clawhubEmailTemplateSources["account-suspended"], replacements),
  );
}

function renderAccountReinstatedTemplate(args: {
  handle?: string;
  restoredAt?: number;
  skillsRestored?: number;
  packagesRestored?: number;
}) {
  const handle = handleLabel(args.handle);
  const restoredAt = formatUtcTimestamp(args.restoredAt, "account review");
  const hasRestoredCounts =
    typeof args.skillsRestored === "number" && typeof args.packagesRestored === "number";
  const preheader = hasRestoredCounts
    ? `Your account is active again - ${args.skillsRestored} skills and ${args.packagesRestored} packages restored. Note: previous API tokens remain revoked.`
    : "Your account is active again. Note: previous API tokens remain revoked.";
  const replacements: Array<[string | RegExp, string]> = [
    [
      "Your account is active again — 12 skills and 3 packages restored. Note: previous API tokens remain revoked.",
      escapeHtml(preheader),
    ],
    ["@octocat", escapeHtml(handle)],
    ["2025-02-20 09:15 UTC", escapeHtml(restoredAt)],
    ["{{unsubscribe_url}}", `${CLAWHUB_URL}/settings`],
  ];
  if (hasRestoredCounts) {
    replacements.push(
      [">12<", `>${escapeHtml(String(args.skillsRestored))}<`],
      [">3<", `>${escapeHtml(String(args.packagesRestored))}<`],
    );
  } else {
    replacements.push(
      [
        /\n<tr>\n<td style="padding:14px 18px;border-bottom:1px solid #26262a;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#8a8a8e;">Skills restored<\/td>\n<td align="right" style="padding:14px 18px;border-bottom:1px solid #26262a;font-family:'Courier New',monospace;font-size:14px;color:#f5f5f5;">12<\/td>\n<\/tr>/,
        "",
      ],
      [
        /\n<tr>\n<td style="padding:14px 18px;border-bottom:1px solid #26262a;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#8a8a8e;">Packages restored<\/td>\n<td align="right" style="padding:14px 18px;border-bottom:1px solid #26262a;font-family:'Courier New',monospace;font-size:14px;color:#f5f5f5;">3<\/td>\n<\/tr>/,
        "",
      ],
    );
  }
  return normalizeFooter(
    replaceAll(clawhubEmailTemplateSources["account-reinstated"], replacements),
  );
}

function reviewFindingBlock(args: {
  findingKind: "warning" | "error";
  meta: string;
  message: string;
  fix?: string;
  docsUrl?: string;
}) {
  const color = args.findingKind === "error" ? "#e8443a" : "#ffb340";
  const label = args.findingKind === "error" ? "ERROR" : "FINDING";
  const fix = args.fix
    ? `<p style="margin:0; font-family:Helvetica, Arial, sans-serif; font-size:14px; line-height:1.6; color:#a8a8ad; border-top:1px solid #1c1c20; padding-top:14px;">
                              <strong style="color:#c9c9ce;">Fix:</strong> ${escapeHtml(args.fix)}
                              ${
                                args.docsUrl
                                  ? `<a href="${escapeHtml(args.docsUrl)}" style="color:#e8443a; text-decoration:none; white-space:nowrap;">Docs →</a>`
                                  : ""
                              }
                            </p>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0e0e10; border:1px solid #26262a; border-radius:10px; margin-bottom:12px;">
                        <tr>
                          <td style="padding:20px 22px;">
                            <p style="margin:0 0 12px 0; font-family:'Courier New', Courier, monospace; font-size:12px; line-height:1.5;">
                              <span style="font-weight:700; color:${color};">${label}</span>
                              <span style="color:#5c5c60;"> · </span>
                              <span style="color:#8a8a8e;">${escapeHtml(args.meta)}</span>
                            </p>
                            <p style="margin:0 0 16px 0; font-family:Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:#f5f5f5;">${escapeHtml(args.message)}</p>
                            ${fix}
                          </td>
                        </tr>
                      </table>`;
}

function renderReviewFailedTemplate(args: {
  title: string;
  packageName: string;
  version: string;
  openClawVersion?: string;
  findingCount: number;
  intro: string;
  findingsHtml: string;
  validateCommand: string;
  footerReason?: string;
}) {
  const issueText = `${args.findingCount} ${args.findingCount === 1 ? "issue" : "issues"}`;
  const packageVersion = `${args.packageName}@${args.version}`;
  const openClawVersion = args.openClawVersion ?? "current";
  return normalizeFooter(
    replaceAll(clawhubEmailTemplateSources["review-failed-a"], [
      ["Review failed for demo-plugin", escapeHtml(args.title)],
      [
        "We found 1 issue with demo-plugin@1.0.0 — review the findings and upload a new version.",
        escapeHtml(args.intro),
      ],
      [
        /<p style="margin:0; font-family:Helvetica, Arial, sans-serif; font-size:15px; line-height:1\.6; color:#a8a8ad;">\n                        Hey, we found <strong style="color:#f5f5f5;">1 issue<\/strong> with version 1\.0\.0 of\n                        <strong style="color:#f5f5f5;">demo-plugin<\/strong>\. Review the findings below, apply the fix,\n                        and upload a new version\.\n                      <\/p>/,
        `<p style="margin:0; font-family:Helvetica, Arial, sans-serif; font-size:15px; line-height:1.6; color:#a8a8ad;">${escapeHtml(args.intro)}</p>`,
      ],
      ["⚠ 1 issue found", `⚠ ${escapeHtml(issueText)} found`],
      ["demo-plugin@1.0.0", escapeHtml(packageVersion)],
      ["2026.4.0", escapeHtml(openClawVersion)],
      [
        /<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0e0e10; border:1px solid #26262a; border-radius:10px;">\n                        <tr>\n                          <td style="padding:20px 22px;">[\s\S]*?<\/table>\n                    <\/td>\n                  <\/tr>\n                  <tr>\n                    <td style="padding:0 40px 32px 40px;">/,
        `${args.findingsHtml}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 40px 32px 40px;">`,
      ],
      ["clawhub package publish &lt;source&gt; --dry-run", escapeHtml(args.validateCommand)],
      [
        /\n\s*<tr>\n\s*<td align="center" style="padding:0 40px 40px 40px;">\n\s*<table role="presentation" cellpadding="0" cellspacing="0">\n\s*<tr>\n\s*<td align="center" style="background-color:#e8443a; border-radius:8px;">\n\s*<a href="https:\/\/clawhub\.ai" style="display:inline-block; padding:13px 32px; font-family:Helvetica, Arial, sans-serif; font-size:14px; font-weight:700; color:#ffffff; text-decoration:none;">Open ClawHub →<\/a>\n\s*<\/td>\n\s*<\/tr>\n\s*<\/table>\n\s*<\/td>\n\s*<\/tr>/,
        "",
      ],
      [
        "You're receiving this because you published a plugin on ClawHub.",
        escapeHtml(
          args.footerReason ?? "You're receiving this because you published a plugin on ClawHub.",
        ),
      ],
      ["{{unsubscribe_url}}", `${CLAWHUB_URL}/settings`],
    ]),
  );
}

function renderGenericOneOffTemplate(args: AdminOneOffEmailArgs) {
  const subject = args.subject.trim();
  const title = args.title?.trim() || subject;
  const actionLabel = args.primaryActionLabel?.trim();
  const actionUrl = args.primaryActionUrl?.trim();
  const replacements: Array<[string | RegExp, string]> = [
    ["{{message_subject}}", escapeHtml(subject)],
    ["{{recipient_handle}}", escapeHtml(args.recipientHandle?.trim() || "there")],
    ["{{message_title}}", escapeHtml(title)],
    ["{{message_body}}", plainTextToTemplateHtml(args.body)],
    ["{{unsubscribe_url}}", `${CLAWHUB_URL}/settings`],
  ];

  if (actionLabel && actionUrl) {
    replacements.push(
      ["{{primary_action_label}}", escapeHtml(actionLabel)],
      ["{{primary_action_url}}", escapeHtml(actionUrl)],
    );
  } else {
    replacements.push([
      /\n\s*<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:32px auto 0 auto;">\n\s*<tr>\n\s*<td style="background-color:#e8443a; border-radius:8px;">\n\s*<a href="{{primary_action_url}}" style="display:inline-block; padding:13px 32px; font-family:Helvetica, Arial, sans-serif; font-size:14px; font-weight:bold; color:#ffffff; text-decoration:none; border-radius:8px;">{{primary_action_label}} →<\/a>\n\s*<\/td>\n\s*<\/tr>\n\s*<\/table>/,
      "",
    ]);
  }

  return normalizeFooter(
    replaceAll(clawhubEmailTemplateSources["generic-one-off-message"], replacements),
  );
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

export function buildBanNotificationEmail(args: BanNotificationEmailArgs): TransactionalEmail {
  const summary = summarizeBanReason(args);
  const artifact = args.artifact ?? null;
  const context: BanNotificationEmailContext = {
    appealUrl: APPEALS_URL,
    artifact,
    scannerLabel: summary.scannerLabel,
    findingSummary: summary.findingSummary,
  };

  const lines = [
    greeting(args.handle),
    "",
    "Your ClawHub account has been suspended.",
    `Reason: ${context.findingSummary}`,
  ];
  if (artifact) lines.push(artifactLabel(artifact));

  lines.push(
    "",
    "What changed:",
    "- Your ClawHub account cannot sign in.",
    "- Existing API tokens for the account have been revoked.",
    "- Published listings owned by the account may be hidden from public view.",
    "",
    `Appeal: ${APPEALS_URL}`,
  );

  lines.push("", "ClawHub Security");

  const impactItems = [
    "Your ClawHub account cannot sign in.",
    "Existing API tokens for the account have been revoked.",
    "Published listings owned by the account may be hidden from public view.",
  ];
  const detailLines = [
    context.findingSummary,
    ...(artifact ? [artifact.name] : []),
    ...impactItems,
  ];
  const hiddenArtifacts =
    typeof args.hiddenArtifacts === "number" && Number.isFinite(args.hiddenArtifacts)
      ? args.hiddenArtifacts
      : artifact
        ? 1
        : undefined;
  const html = renderAccountSuspendedTemplate({
    handle: args.handle,
    suspendedAt: args.bannedAt,
    hiddenArtifacts,
    preheader: detailLines.join(" "),
  });

  return {
    subject: "Your ClawHub account has been suspended",
    context,
    text: lines.join("\n"),
    html,
  };
}

export function buildRestoredAccountEmail(args: RestoredAccountEmailArgs) {
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
  const html = renderAccountReinstatedTemplate({
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

export function buildMaliciousArtifactEmail(args: MaliciousArtifactEmailArgs) {
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

  const findingsHtml = reviewFindingBlock({
    findingKind: "error",
    meta: `${artifactKind} security`,
    message: findingSummary,
    fix: `Download the scan results for the blocked submitted version, then upload a fixed ${artifactKind} with a new version number. ${MALICIOUS_REJECTION_ACCOUNT_WARNING}`,
    docsUrl: MODERATION_GUIDELINES_URL,
  });
  const html = renderReviewFailedTemplate({
    title: subject,
    packageName: args.artifact.name,
    version: args.version?.trim() || "<version>",
    findingCount: 1,
    intro: `${artifactLabelText} was blocked by ClawHub security scans.`,
    findingsHtml,
    validateCommand: scanDownloadCommand,
    footerReason: `You're receiving this because you uploaded a ${artifactKind} to ClawHub.`,
  });

  return {
    subject,
    text: lines.join("\n"),
    html,
  };
}

export function buildPackageInspectorFindingsEmail(args: PackageInspectorFindingsEmailArgs) {
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

  const findingsHtml = args.findings
    .map((finding) => {
      const meta = [finding.code, finding.issueClass, finding.severity].filter(Boolean).join(" · ");
      return reviewFindingBlock({
        findingKind: finding.findingKind,
        meta,
        message: finding.message,
        fix: finding.authorRemediation?.summary,
        docsUrl: finding.authorRemediation?.docsUrl,
      });
    })
    .join("");
  const html = renderReviewFailedTemplate({
    title: "Plugin Inspector findings",
    packageName: args.packageName,
    version: args.version,
    openClawVersion: targetOpenClawVersion,
    findingCount,
    intro,
    findingsHtml,
    validateCommand,
    footerReason: "You're receiving this because you published a plugin on ClawHub.",
  });

  return {
    subject,
    text: lines.join("\n"),
    html,
  };
}

export function buildAdminOneOffEmail(args: AdminOneOffEmailArgs) {
  const title = args.title?.trim() || args.subject.trim();
  const lines = [greeting(args.recipientHandle), "", title, "", args.body.trim()];
  if (args.primaryActionLabel?.trim() && args.primaryActionUrl?.trim()) {
    lines.push("", `${args.primaryActionLabel.trim()}: ${args.primaryActionUrl.trim()}`);
  }
  lines.push("", "ClawHub Team");

  const html = renderGenericOneOffTemplate(args);

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
