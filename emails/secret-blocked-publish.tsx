import {
  Badge,
  ClawHubEmailLayout,
  DetailTable,
  EmailHeading,
  FindingCard,
  Paragraph,
} from "./_components/clawhub";

export type SecretBlockedPublishEmailProps = {
  artifactKind: "skill" | "plugin";
  artifactName: string;
  version: string;
  preheader: string;
};

export default function SecretBlockedPublishEmail({
  artifactKind,
  artifactName,
  version,
  preheader,
}: SecretBlockedPublishEmailProps) {
  const title = `ClawHub blocked a ${artifactKind} publish`;
  const railLabel = artifactKind === "plugin" ? "Plugin Review" : "Skill Review";
  return (
    <ClawHubEmailLayout preview={preheader} railLabel={railLabel}>
      <Badge>Secret found</Badge>
      <EmailHeading>{title}</EmailHeading>
      <Paragraph>
        TruffleHog found a secret-looking value in this upload. This version was not made public.
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
      <FindingCard
        kind="error"
        meta="TruffleHog"
        message="A secret-looking value was found in the uploaded files."
        fix={`Rotate the secret if it was real, remove it from the ${artifactKind}, and upload a new version.`}
      />
    </ClawHubEmailLayout>
  );
}

SecretBlockedPublishEmail.PreviewProps = {
  artifactKind: "skill",
  artifactName: "secret-skill",
  version: "1.0.0",
  preheader: "secret-skill@1.0.0 was blocked before public listing because a secret was found.",
} satisfies SecretBlockedPublishEmailProps;
