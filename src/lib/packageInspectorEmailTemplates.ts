type EmailFinding = {
  code: string;
  issueClass?: string;
  level?: string;
  severity?: string;
  message: string;
};

type InspectorEmail = {
  subject: string;
  text: string;
  html: string;
};

export function renderPluginInspectorBlockedPublishEmail(args: {
  packageName: string;
  version: string;
  findings: EmailFinding[];
}): InspectorEmail {
  const text = [
    `Your ClawHub publish for ${args.packageName}@${args.version} was blocked by Plugin Inspector.`,
    "",
    "Fix the hard findings below and publish again:",
    "",
    ...formatFindings(args.findings),
  ].join("\n");
  return {
    subject: `Plugin publish blocked for ${args.packageName}@${args.version}`,
    text,
    html: renderHtml({
      title: "Plugin publish blocked",
      intro: `Your ClawHub publish for ${args.packageName}@${args.version} was blocked by Plugin Inspector.`,
      packageName: args.packageName,
      version: args.version,
      findings: args.findings,
    }),
  };
}

export function renderPluginInspectorWarningsEmail(args: {
  packageName: string;
  version: string;
  warningUrl: string;
  inspectorVersion?: string;
  targetOpenClawVersion?: string;
  intro?: string;
  warnings: EmailFinding[];
}): InspectorEmail {
  const intro =
    args.intro ??
    `Your ClawHub publish for ${args.packageName}@${args.version} was published, but Plugin Inspector found non-blocking warnings.`;
  const text = [
    intro,
    "",
    `Plugin: ${args.packageName}@${args.version}`,
    args.inspectorVersion ? `Plugin Inspector: ${args.inspectorVersion}` : null,
    args.targetOpenClawVersion ? `Target OpenClaw: ${args.targetOpenClawVersion}` : null,
    "",
    "Review the findings:",
    args.warningUrl,
    "",
    ...formatFindings(args.warnings),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return {
    subject: `Plugin Inspector findings for ${args.packageName}@${args.version}`,
    text,
    html: renderHtml({
      title: "Plugin Inspector findings",
      intro,
      packageName: args.packageName,
      version: args.version,
      inspectorVersion: args.inspectorVersion,
      targetOpenClawVersion: args.targetOpenClawVersion,
      warningUrl: args.warningUrl,
      findings: args.warnings,
    }),
  };
}

function formatFindings(findings: EmailFinding[]) {
  if (findings.length === 0) return ["- No findings were included."];
  return findings.map((finding) => {
    const label = finding.issueClass ? `${finding.code} (${finding.issueClass})` : finding.code;
    return `- ${label}: ${finding.message}`;
  });
}

function renderHtml(args: {
  title: string;
  intro: string;
  packageName: string;
  version: string;
  warningUrl?: string;
  inspectorVersion?: string;
  targetOpenClawVersion?: string;
  findings: EmailFinding[];
}) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7f9;color:#1f2933;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <main style="max-width:640px;margin:0 auto;padding:32px 18px;">
      <section style="background:#ffffff;border:1px solid #d8dee6;border-radius:8px;padding:24px;">
        <p style="margin:0 0 8px;color:#5b6472;font-size:13px;">ClawHub Plugin Inspector</p>
        <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;">${escapeHtml(args.title)}</h1>
        <p style="margin:0 0 18px;line-height:1.55;">${escapeHtml(args.intro)}</p>
        <div style="margin:0 0 18px;padding:12px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;">
          <p style="margin:0 0 6px;"><strong>Plugin:</strong> ${escapeHtml(args.packageName)}@${escapeHtml(args.version)}</p>
          ${args.inspectorVersion ? `<p style="margin:0 0 6px;"><strong>Plugin Inspector:</strong> ${escapeHtml(args.inspectorVersion)}</p>` : ""}
          ${args.targetOpenClawVersion ? `<p style="margin:0;"><strong>Target OpenClaw:</strong> ${escapeHtml(args.targetOpenClawVersion)}</p>` : ""}
        </div>
        <ul style="margin:0 0 20px;padding:0;list-style:none;">
          ${args.findings.map(renderFindingHtml).join("")}
        </ul>
        ${args.warningUrl ? `<p style="margin:0;"><a href="${escapeHtml(args.warningUrl)}" style="display:inline-block;border-radius:6px;background:#111827;color:#ffffff;text-decoration:none;padding:10px 14px;font-weight:700;">View plugin warnings</a></p>` : ""}
      </section>
    </main>
  </body>
</html>`;
}

function renderFindingHtml(finding: EmailFinding) {
  const kind = finding.level === "breakage" || finding.severity === "P0" ? "error" : "warning";
  const color = kind === "error" ? "#b42318" : "#a15c07";
  return `<li style="margin:0 0 10px;padding:12px;border:1px solid #e2e8f0;border-radius:6px;">
    <p style="margin:0 0 6px;"><span style="display:inline-block;margin-right:8px;color:${color};font-weight:700;text-transform:uppercase;">${kind}</span><code>${escapeHtml(finding.code)}</code>${finding.issueClass ? ` <span style="color:#5b6472;">${escapeHtml(finding.issueClass)}</span>` : ""}</p>
    <p style="margin:0;line-height:1.5;">${escapeHtml(finding.message)}</p>
  </li>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
