import { ClawHubEmailLayout, DetailTable, EmailHeading, Paragraph } from "./_components/clawhub";

export type TemplateNotPublishedEmailProps = {
  displayName: string;
  packageName: string;
  version: string;
  outcome: "blocked" | "scan_failed";
};

export default function TemplateNotPublishedEmail({
  displayName,
  packageName,
  version,
  outcome,
}: TemplateNotPublishedEmailProps) {
  const blocked = outcome === "blocked";
  const heading = blocked
    ? `ClawHub blocked ${displayName} ${version}`
    : `We couldn’t finish checking ${displayName} ${version}`;
  return (
    <ClawHubEmailLayout preview={heading}>
      <EmailHeading>{heading}</EmailHeading>
      <Paragraph>
        {blocked
          ? "ClawScan flagged the contents of this upload as malicious. This version was not published."
          : "ClawHub’s security checks did not finish after three attempts. This version was not published. This is a scanner error, not a rejection of your template."}
      </Paragraph>
      <DetailTable
        rows={[
          ["Template", packageName],
          ["Version", version],
        ]}
      />
      <Paragraph>
        {blocked
          ? "Review the files included in this template and remove any unsafe content before submitting a corrected version with a new version number."
          : "If you need help completing publication, contact ClawHub support with the template name and version above."}
      </Paragraph>
    </ClawHubEmailLayout>
  );
}

TemplateNotPublishedEmail.PreviewProps = {
  displayName: "Standup Prep",
  packageName: "@octocat/standup-prep",
  version: "1.0.0",
  outcome: "blocked",
} satisfies TemplateNotPublishedEmailProps;
