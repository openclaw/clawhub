import type { ReactNode } from "react";
import {
  Badge,
  ClawHubEmailLayout,
  CodeBox,
  DetailTable,
  EmailHeading,
  FindingCard,
  Paragraph,
} from "./_components/clawhub";

export type BlockedVersionEmailProps = {
  artifactKind: "skill" | "plugin";
  artifactName: string;
  version: string;
  findingSummary: string;
  validateCommand: string;
  docsUrl: string;
  preheader: string;
};

export default function BlockedVersionEmail({
  artifactKind,
  artifactName,
  version,
  findingSummary,
  validateCommand,
  docsUrl,
  preheader,
}: BlockedVersionEmailProps) {
  const title = `ClawHub blocked a ${artifactKind} version`;
  const railLabel = artifactKind === "plugin" ? "Plugin Review" : "Skill Review";
  return (
    <ClawHubEmailLayout preview={preheader} railLabel={railLabel}>
      <Badge>1 issue found</Badge>
      <EmailHeading>{title}</EmailHeading>
      <Paragraph>
        {artifactName} was blocked by ClawHub security scans. This version was not made public.
      </Paragraph>
      <DetailTable
        rows={[
          [artifactKind === "plugin" ? "Plugin" : "Skill", `${artifactName}@${version}`],
          [
            "Status",
            <span key="status" style={{ color: "#e8443a" }}>
              BLOCKED
            </span>,
          ],
        ]}
      />
      <HeadingLabel>Findings</HeadingLabel>
      <FindingCard
        kind="error"
        meta={`${artifactKind} security`}
        message={findingSummary}
        fix={`Download the scan results for the blocked submitted version, then upload a fixed ${artifactKind} with a new version number. Repeated malicious rejections may lead to account disablement.`}
        docsUrl={docsUrl}
      />
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

BlockedVersionEmail.PreviewProps = {
  artifactKind: "plugin",
  artifactName: "@scope/demo-plugin",
  version: "1.2.3",
  findingSummary: "Attempts to exfiltrate credentials.",
  validateCommand: "clawhub scan download @scope/demo-plugin --version 1.2.3 --kind plugin",
  docsUrl: "https://docs.openclaw.ai/clawhub/moderation",
  preheader: "ClawHub blocked @scope/demo-plugin@1.2.3 after a security scan.",
} satisfies BlockedVersionEmailProps;
