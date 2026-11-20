import {
  ActionButton,
  ClawHubEmailLayout,
  DetailTable,
  EmailHeading,
  Paragraph,
} from "./_components/clawhub";

export type TemplatePublishedEmailProps = {
  displayName: string;
  packageName: string;
  version: string;
  publishedAt: string;
  templateUrl: string;
  auditPassed: boolean;
};

export default function TemplatePublishedEmail({
  displayName,
  packageName,
  version,
  publishedAt,
  templateUrl,
  auditPassed,
}: TemplatePublishedEmailProps) {
  const description = auditPassed
    ? `Version ${version} passed ClawHub’s security audit.`
    : `Version ${version} is now available on ClawHub.`;
  return (
    <ClawHubEmailLayout preview={description} topColor="#3fb950">
      <EmailHeading>{`${displayName} is now public`}</EmailHeading>
      <Paragraph>{description}</Paragraph>
      <DetailTable
        rows={[
          ["Template", packageName],
          ["Version", version],
          ["Published", publishedAt],
        ]}
      />
      <ActionButton href={templateUrl}>View your template</ActionButton>
    </ClawHubEmailLayout>
  );
}

TemplatePublishedEmail.PreviewProps = {
  displayName: "Standup Prep",
  packageName: "@octocat/standup-prep",
  version: "1.0.0",
  publishedAt: "Nov 18, 2026 · 21:04 UTC",
  templateUrl: "https://clawhub.ai/octocat/templates/standup-prep",
  auditPassed: true,
} satisfies TemplatePublishedEmailProps;
