export const APPEALS_URL = "https://appeals.openclaw.ai/";
export const MODERATION_GUIDELINES_URL = "https://docs.openclaw.ai/clawhub/moderation";
export const MALICIOUS_REJECTION_ACCOUNT_WARNING =
  "Repeated malicious rejections may lead to account disablement.";

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
};

export type MaliciousArtifactEmailArgs = {
  handle?: string;
  artifact: NotificationArtifact;
  version?: string;
  trigger?: string;
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

function emailShell(args: { preheader: string; title: string; body: string }) {
  return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>${escapeHtml(args.title)}</title>
  </head>
  <body style="margin:0;background:#ffffff;color:#1f2328;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(
      args.preheader,
    )}</span>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;margin:0;padding:24px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;">
            <tr>
              <td style="padding:0;font-size:15px;line-height:22px;color:#1f2328;">
                ${args.body}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function textLink(href: string, label: string) {
  return `<a href="${escapeHtml(href)}" style="color:#0969da;text-decoration:underline;">${escapeHtml(label)}</a>`;
}

function detailLine(label: string, value: string) {
  return `<p style="margin:0 0 6px;font-size:15px;line-height:22px;color:#1f2328;"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`;
}

function sectionHeading(label: string) {
  return `<p style="margin:18px 0 8px;font-size:15px;line-height:22px;color:#1f2328;"><strong>${escapeHtml(label)}</strong></p>`;
}

function paragraph(value: string) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:#1f2328;">${escapeHtml(value)}</p>`;
}

function bulletList(items: string[]) {
  return `<ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:22px;color:#1f2328;">${items
    .map((item) => `<li style="margin:0 0 6px;">${escapeHtml(item)}</li>`)
    .join("")}</ul>`;
}

function commandBlock(command: string) {
  return `<pre style="margin:8px 0 14px;padding:10px 12px;background:#f6f8fa;border:1px solid #d8dee4;border-radius:6px;white-space:pre-wrap;color:#1f2328;font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:13px;line-height:20px;"><code>${escapeHtml(command)}</code></pre>`;
}

function buildScanDownloadCommand(args: MaliciousArtifactEmailArgs) {
  const version = args.version?.trim() || "<version>";
  const kindFlag = args.artifact.kind === "plugin" ? " --kind plugin" : "";
  return `clawhub scan download ${args.artifact.name} --version ${version}${kindFlag}`;
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
    "Your ClawHub account was disabled.",
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
    detailLine("Reason", context.findingSummary),
    ...(artifact
      ? [detailLine(artifact.kind === "skill" ? "Skill" : "Plugin", artifact.name)]
      : []),
  ].join("");

  const html = emailShell({
    title: "Your ClawHub account was disabled",
    preheader: context.findingSummary,
    body: [
      paragraph(greeting(args.handle)),
      paragraph("We disabled your ClawHub account after an account-safety review."),
      detailLines,
      sectionHeading("What changed"),
      bulletList(impactItems),
      `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:#1f2328;">You can ${textLink(APPEALS_URL, "appeal this decision")} if you believe this was a mistake.</p>`,
      `<p style="margin:18px 0 0;color:#6a737d;font-size:13px;line-height:20px;">If you already appealed, you do not need to send a separate support email.</p>`,
      paragraph("ClawHub Security"),
    ].join(""),
  });

  return {
    subject: "Your ClawHub account was disabled",
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

  const html = emailShell({
    title: "Your ClawHub account was restored",
    preheader: "Your ClawHub account can sign in again.",
    body: [
      paragraph(greeting(args.handle)),
      paragraph("Your ClawHub account can sign in again."),
      paragraph(
        "Previously revoked API tokens stay revoked. Create a new token before using the CLI or API again.",
      ),
      listingLines.length > 0
        ? `${sectionHeading("Restored listings")}${bulletList(listingLines)}`
        : "",
      `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:#1f2328;">Settings: ${textLink("https://clawhub.ai/settings", "open ClawHub settings")}</p>`,
      paragraph("ClawHub Security"),
    ].join(""),
  });

  return {
    subject: "Your ClawHub account was restored",
    text: lines.join("\n"),
    html,
  };
}

export function buildMaliciousArtifactEmail(args: MaliciousArtifactEmailArgs) {
  const artifactKind = args.artifact.kind === "skill" ? "skill" : "plugin";
  const artifactLabelText = artifactLabel(args.artifact);
  const scanDownloadCommand = buildScanDownloadCommand(args);
  const findingSummary =
    args.trigger?.includes("static") === true
      ? "Static analysis flagged malicious upload patterns."
      : args.trigger?.includes("virustotal") === true || args.trigger?.includes("vt_") === true
        ? "VirusTotal telemetry contributed to a malicious upload finding."
        : "ClawScan classified the uploaded artifact as malicious.";
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

  const detailLines = [
    detailLine("Reason", findingSummary),
    detailLine(args.artifact.kind === "skill" ? "Skill" : "Plugin", args.artifact.name),
    ...(args.version?.trim() ? [detailLine("Version", args.version.trim())] : []),
  ].join("");

  const html = emailShell({
    title: subject,
    preheader: `${artifactLabelText} was blocked by ClawHub security scans.`,
    body: [
      paragraph(greeting(args.handle)),
      paragraph(`ClawHub blocked a ${artifactKind} version after a security scan.`),
      detailLines,
      sectionHeading("What changed"),
      bulletList([
        "This version was not made public.",
        "Your account can still sign in.",
        `You can upload a fixed version of this ${artifactKind}.`,
        MALICIOUS_REJECTION_ACCOUNT_WARNING,
      ]),
      sectionHeading("Review the blocked-version scan results"),
      paragraph("Download the scan results for the blocked submitted version."),
      commandBlock(scanDownloadCommand),
      paragraph(`Increment the version number before uploading the fixed ${artifactKind}.`),
      `<p style="margin:0 0 14px;font-size:15px;line-height:22px;color:#1f2328;">Docs: ${textLink(MODERATION_GUIDELINES_URL, "moderation and account safety")}</p>`,
      paragraph("ClawHub Security"),
    ].join(""),
  });

  return {
    subject,
    text: lines.join("\n"),
    html,
  };
}
