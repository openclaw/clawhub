import type { ReactNode } from "react";
import {
  Badge,
  ClawHubEmailLayout,
  CodeBox,
  DetailTable,
  EmailHeading,
  FindingCard,
  Paragraph,
  type FindingCardProps,
} from "./_components/clawhub";

export type PluginInspectorFindingEmailItem = FindingCardProps & {
  code: string;
};

export type PluginInspectorFindingsEmailProps = {
  packageName: string;
  version: string;
  openClawVersion?: string;
  findings: PluginInspectorFindingEmailItem[];
  validateCommand: string;
  preheader: string;
};

export default function PluginInspectorFindingsEmail({
  packageName,
  version,
  openClawVersion,
  findings,
  validateCommand,
  preheader,
}: PluginInspectorFindingsEmailProps) {
  const issueText = `${findings.length} ${findings.length === 1 ? "issue" : "issues"}`;
  return (
    <ClawHubEmailLayout preview={preheader} railLabel="Plugin Review">
      <Badge>{`${issueText} found`}</Badge>
      <EmailHeading>Plugin Inspector findings</EmailHeading>
      <Paragraph>{`We found ${issueText} with version ${version} of ${packageName}.`}</Paragraph>
      <DetailTable
        rows={[
          ["Plugin", `${packageName}@${version}`],
          ["OpenClaw Version", openClawVersion ?? "current"],
        ]}
      />
      <HeadingLabel>Findings</HeadingLabel>
      {findings.map((finding) => (
        <FindingCard key={finding.code} {...finding} />
      ))}
      <HeadingLabel>Validate a local fix</HeadingLabel>
      <CodeBox>{validateCommand}</CodeBox>
    </ClawHubEmailLayout>
  );
}

function HeadingLabel({ children }: { children: ReactNode }) {
  return (
    <h2
      style={{
        margin: "28px 0 14px",
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: "16px",
        color: "#f5f5f5",
      }}
    >
      {children}
    </h2>
  );
}

PluginInspectorFindingsEmail.PreviewProps = {
  packageName: "demo-plugin",
  version: "1.0.0",
  openClawVersion: "2026.4.0",
  validateCommand: "clawhub package validate <path-to-plugin>",
  preheader: "Plugin Inspector found 1 issue with demo-plugin@1.0.0.",
  findings: [
    {
      code: "legacy-before-agent-start",
      kind: "warning",
      meta: "legacy-before-agent-start · deprecation-warning · P2",
      message: "legacy before_agent_start hook is deprecated",
      fix: "Replace the legacy before_agent_start hook with current prompt hooks.",
      docsUrl: "https://docs.openclaw.ai/clawhub/plugin-validation-fixes#legacy-before-agent-start",
    },
  ],
} satisfies PluginInspectorFindingsEmailProps;
