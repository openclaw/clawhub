import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

const DEFAULT_SECURITY_EMAIL = "security@openclaw.org";

export type BanNotificationSource = "manual" | "autoban";
export type UnbanNotificationSource = "manual" | "autoban_remediation";
export type BanNotificationArtifactKind = "skill" | "plugin";

export type BanNotificationArtifact = {
  kind: BanNotificationArtifactKind;
  name: string;
};

export type RestoredListing = {
  kind: BanNotificationArtifactKind;
  name: string;
};

export type UnbanNotificationListingContext = {
  targetUserId: Id<"users">;
  bannedAt: number;
  triggerSkillIds?: Array<Id<"skills">>;
};

export const banNotificationArtifactValidator = v.object({
  kind: v.union(v.literal("skill"), v.literal("plugin")),
  name: v.string(),
});

export const restoredListingValidator = v.object({
  kind: v.union(v.literal("skill"), v.literal("plugin")),
  name: v.string(),
});

export const unbanNotificationListingContextValidator = v.object({
  targetUserId: v.id("users"),
  bannedAt: v.number(),
  triggerSkillIds: v.optional(v.array(v.id("skills"))),
});

type BanNotificationEmailArgs = {
  userId: Id<"users">;
  bannedAt: number;
  to: string;
  handle?: string;
  reason?: string;
  artifact?: BanNotificationArtifact;
  source: BanNotificationSource;
};

type UnbanNotificationEmailArgs = {
  userId: Id<"users">;
  restoredAt: number;
  to: string;
  handle?: string;
  restoredListings?: RestoredListing[];
  source: UnbanNotificationSource;
};

export async function sendBanNotificationEmail(args: BanNotificationEmailArgs) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(`[ban-email] RESEND_API_KEY missing; skipped email for ${args.userId}`);
    return { ok: false as const, reason: "missing_api_key" as const };
  }

  const from = getBanNotificationFromAddress();
  const replyTo = getSecurityEmailAddress();
  const text = buildBanNotificationText(args);
  const html = buildBanNotificationHtml(args);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `clawhub-ban-${args.userId}-${args.bannedAt}`,
      },
      body: JSON.stringify({
        from,
        to: args.to,
        reply_to: replyTo,
        subject: "Your ClawHub account was disabled",
        text,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `[ban-email] Resend failed for ${args.userId}: ${response.status} ${body.slice(0, 500)}`,
      );
      return { ok: false as const, reason: "resend_error" as const, status: response.status };
    }
  } catch (error) {
    console.warn(`[ban-email] Failed to send ban notification for ${args.userId}`, error);
    return { ok: false as const, reason: "send_error" as const };
  }

  return { ok: true as const };
}

export async function sendUnbanNotificationEmail(args: UnbanNotificationEmailArgs) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(`[unban-email] RESEND_API_KEY missing; skipped email for ${args.userId}`);
    return { ok: false as const, reason: "missing_api_key" as const };
  }

  const from = getBanNotificationFromAddress();
  const replyTo = getSecurityEmailAddress();
  const text = buildUnbanNotificationText(args);
  const html = buildUnbanNotificationHtml(args);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `clawhub-unban-${args.userId}-${args.restoredAt}`,
      },
      body: JSON.stringify({
        from,
        to: args.to,
        reply_to: replyTo,
        subject: "Your ClawHub account was restored",
        text,
        html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn(
        `[unban-email] Resend failed for ${args.userId}: ${response.status} ${body.slice(0, 500)}`,
      );
      return { ok: false as const, reason: "resend_error" as const, status: response.status };
    }
  } catch (error) {
    console.warn(`[unban-email] Failed to send unban notification for ${args.userId}`, error);
    return { ok: false as const, reason: "send_error" as const };
  }

  return { ok: true as const };
}

function getSecurityEmailAddress() {
  return process.env.CLAWHUB_SECURITY_EMAIL?.trim() || DEFAULT_SECURITY_EMAIL;
}

function getBanNotificationFromAddress() {
  return process.env.CLAWHUB_SECURITY_EMAIL_FROM?.trim() || getSecurityEmailAddress();
}

function buildBanNotificationText(args: {
  handle?: string;
  reason?: string;
  artifact?: BanNotificationArtifact;
  source: BanNotificationSource;
}) {
  const greeting = args.handle ? `Hi ${args.handle},` : "Hi,";
  const lines = [greeting, "", getBanNotificationIntro(args.source, args.artifact)];
  if (args.artifact) {
    const label = args.artifact.kind === "plugin" ? "Plugin" : "Skill";
    lines.push(`${label} name: ${args.artifact.name}.`);
  }
  const finding = formatBanNotificationFinding(args.reason, args.source);
  if (finding) lines.push(finding);
  lines.push(
    "",
    "What this means right now:",
    "- Your ClawHub account cannot sign in.",
    "- API tokens for the account have been revoked.",
    "- Published skills owned by the account have been hidden from public view.",
    "",
    "If you believe this was a mistake, reply to this email and the ClawHub security team will review the decision.",
    "",
    "ClawHub Security",
    getSecurityEmailAddress(),
  );
  return lines.join("\n");
}

function buildBanNotificationHtml(args: {
  handle?: string;
  reason?: string;
  artifact?: BanNotificationArtifact;
  source: BanNotificationSource;
}) {
  const securityEmail = getSecurityEmailAddress();
  const finding = formatBanNotificationFindingValue(args.reason, args.source);
  const rows: string[] = [];
  if (args.artifact) {
    rows.push(
      buildHtmlKeyValueRow(
        args.artifact.kind === "plugin" ? "Plugin name" : "Skill name",
        args.artifact.name,
      ),
    );
  }
  if (finding) rows.push(buildHtmlKeyValueRow("Security finding", finding));

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;color:#202124;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">
    <div style="max-width:720px;padding:24px;">
      <p style="margin:0 0 16px;">${escapeHtml(args.handle ? `Hi ${args.handle},` : "Hi,")}</p>
      <p style="margin:0 0 16px;">${escapeHtml(getBanNotificationIntro(args.source, args.artifact))}</p>
      ${
        rows.length
          ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 16px;">${rows.join("")}</table>`
          : ""
      }
      <p style="margin:0 0 8px;"><strong>What this means right now:</strong></p>
      <ul style="margin:0 0 16px 20px;padding:0;">
        <li>Your ClawHub account cannot sign in.</li>
        <li>API tokens for the account have been revoked.</li>
        <li>Published skills owned by the account have been hidden from public view.</li>
      </ul>
      <p style="margin:0 0 16px;">If you believe this was a mistake, reply to this email and the ClawHub security team will review the decision.</p>
      <p style="margin:0;">ClawHub Security<br><a href="mailto:${escapeHtml(securityEmail)}" style="color:#1155cc;">${escapeHtml(securityEmail)}</a></p>
    </div>
  </body>
</html>`;
}

function buildUnbanNotificationText(args: {
  handle?: string;
  restoredListings?: RestoredListing[];
  source: UnbanNotificationSource;
}) {
  const greeting = args.handle ? `Hi ${args.handle},` : "Hi,";
  const restoredListings = buildRestoredListingTextLines(args.restoredListings);
  const lines = [
    greeting,
    "",
    getUnbanNotificationIntro(args.source),
    "",
    "What this means right now:",
    "- Your ClawHub account can sign in again.",
    ...restoredListings,
    "- Previously revoked API tokens stay revoked. Create a new API token if you need CLI or API access.",
    "",
    "If you have questions, reply to this email and the ClawHub security team will review.",
    "",
    "ClawHub Security",
    getSecurityEmailAddress(),
  ];
  return lines.join("\n");
}

function buildUnbanNotificationHtml(args: {
  handle?: string;
  restoredListings?: RestoredListing[];
  source: UnbanNotificationSource;
}) {
  const securityEmail = getSecurityEmailAddress();
  const restoredListings = buildRestoredListingHtmlItems(args.restoredListings);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;color:#202124;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;">
    <div style="max-width:720px;padding:24px;">
      <p style="margin:0 0 16px;">${escapeHtml(args.handle ? `Hi ${args.handle},` : "Hi,")}</p>
      <p style="margin:0 0 16px;">${escapeHtml(getUnbanNotificationIntro(args.source))}</p>
      <p style="margin:0 0 8px;"><strong>What this means right now:</strong></p>
      <ul style="margin:0 0 16px 20px;padding:0;">
        <li>Your ClawHub account can sign in again.</li>
        ${restoredListings}
        <li>Previously revoked API tokens stay revoked. Create a new API token if you need CLI or API access.</li>
      </ul>
      <p style="margin:0 0 16px;">If you have questions, reply to this email and the ClawHub security team will review.</p>
      <p style="margin:0;">ClawHub Security<br><a href="mailto:${escapeHtml(securityEmail)}" style="color:#1155cc;">${escapeHtml(securityEmail)}</a></p>
    </div>
  </body>
</html>`;
}

function buildRestoredListingTextLines(restoredListings: RestoredListing[] | undefined) {
  if (!restoredListings?.length) {
    return ["- Eligible published listings restored during the review are visible again."];
  }
  return [
    "- Restored listings:",
    ...restoredListings.map(
      (listing) => `  - ${formatRestoredListingLabel(listing)}: ${listing.name}`,
    ),
  ];
}

function buildRestoredListingHtmlItems(restoredListings: RestoredListing[] | undefined) {
  if (!restoredListings?.length) {
    return "<li>Eligible published listings restored during the review are visible again.</li>";
  }
  const items = restoredListings
    .map(
      (listing) =>
        `<li>${escapeHtml(formatRestoredListingLabel(listing))}: ${escapeHtml(listing.name)}</li>`,
    )
    .join("");
  return `<li>Restored listings:<ul style="margin:4px 0 0 20px;padding:0;">${items}</ul></li>`;
}

function formatRestoredListingLabel(listing: RestoredListing) {
  return listing.kind === "plugin" ? "Plugin" : "Skill";
}

function buildHtmlKeyValueRow(label: string, value: string) {
  return `<tr><td style="padding:0 16px 4px 0;vertical-align:top;white-space:nowrap;"><strong>${escapeHtml(label)}:</strong></td><td style="padding:0 0 4px;vertical-align:top;">${escapeHtml(value)}</td></tr>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getBanNotificationIntro(
  source: BanNotificationSource,
  artifact?: BanNotificationArtifact,
) {
  if (source !== "autoban") return "Your ClawHub account was disabled after a security review.";
  if (artifact?.kind === "skill") {
    return "Your ClawHub account was disabled after automated security checks flagged an uploaded skill.";
  }
  if (artifact?.kind === "plugin") {
    return "Your ClawHub account was disabled after automated security checks flagged an uploaded plugin.";
  }
  return "Your ClawHub account was disabled after automated security checks flagged an uploaded skill or plugin.";
}

function getUnbanNotificationIntro(source: UnbanNotificationSource) {
  if (source === "autoban_remediation") {
    return "Your ClawHub account has been restored after ClawHub security checks were reviewed again.";
  }
  return "Your ClawHub account has been restored after a security review.";
}

function formatBanNotificationFindingValue(
  reason: string | undefined,
  source: BanNotificationSource,
) {
  const normalized = reason?.trim();
  if (!normalized) return undefined;
  if (source === "manual" && normalized.startsWith("comment scam auto-ban.")) {
    return "ClawHub security checks found high-confidence scam activity from the account.";
  }
  if (source === "manual" && /\b(?:commentId|skillId|userId)=/.test(normalized)) {
    return "ClawHub security checks found high-confidence policy-violating activity from the account.";
  }
  if (normalized === "vt.malicious" || normalized === "malicious.vt_malicious") {
    return "VirusTotal reported the upload as malicious.";
  }
  if (normalized === "malicious.llm_malicious") {
    return "ClawScan classified the upload as malicious.";
  }
  if (normalized === "static.malicious" || normalized.startsWith("malicious.")) {
    return "ClawHub security checks classified the upload as malicious.";
  }
  if (normalized.startsWith("suspicious.")) {
    return "ClawHub security checks flagged suspicious upload behavior.";
  }
  if (source === "autoban") {
    return "ClawHub security checks classified the upload as malicious.";
  }
  return normalized.endsWith(".") ? normalized : `${normalized}.`;
}

function formatBanNotificationFinding(reason: string | undefined, source: BanNotificationSource) {
  const finding = formatBanNotificationFindingValue(reason, source);
  if (!finding) return undefined;
  return source === "manual"
    ? `Security review finding: ${finding}`
    : `Security finding: ${finding}`;
}
