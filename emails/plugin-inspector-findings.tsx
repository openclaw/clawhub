import { Body, Button, Container, Head, Html, Text } from "@react-email/components";

export type PluginInspectorFindingsEmailProps = {
  owner: string;
  packageName: string;
  version: string;
  validationUrl: string;
  preheader: string;
};

export default function PluginInspectorFindingsEmail({
  owner,
  packageName,
  version,
  validationUrl,
}: PluginInspectorFindingsEmailProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={bodyStyle}>
        <Container style={containerStyle}>
          <Text style={paragraphStyle}>{`Hi ${owner},`}</Text>
          <Text style={paragraphStyle}>
            {`ClawHub validated ${packageName}@${version} against the upcoming OpenClaw release.`}
          </Text>
          <Text style={paragraphStyle}>
            The plugin uses an import, API, or hook that will no longer be available. If unchanged,
            the affected functionality will fail when users upgrade OpenClaw.
          </Text>
          <Button href={validationUrl} style={buttonStyle}>
            Review the validation errors
          </Button>
          <Text style={paragraphStyle}>
            Your plugin page includes the exact errors, affected files, tested OpenClaw version,
            reproduction command, and fix guidance when available.
          </Text>
          <Text style={paragraphStyle}>
            Please update the plugin and publish a new version before the next OpenClaw release.
          </Text>
          <Text style={paragraphStyle}>—ClawHub</Text>
        </Container>
      </Body>
    </Html>
  );
}

const bodyStyle = { margin: 0, padding: "32px 16px", backgroundColor: "#0a0a0b" };
const containerStyle = {
  width: "600px",
  maxWidth: "600px",
  padding: "36px",
  backgroundColor: "#141416",
  border: "1px solid #26262a",
  borderRadius: "14px",
};
const paragraphStyle = {
  margin: "0 0 18px",
  fontFamily: "Helvetica, Arial, sans-serif",
  fontSize: "15px",
  lineHeight: "23px",
  color: "#f5f5f5",
};
const buttonStyle = {
  display: "inline-block",
  margin: "0 0 18px",
  padding: "12px 18px",
  backgroundColor: "#e8443a",
  borderRadius: "8px",
  color: "#ffffff",
  fontFamily: "Helvetica, Arial, sans-serif",
  fontSize: "14px",
  fontWeight: "bold",
  textDecoration: "none",
};

PluginInspectorFindingsEmail.PreviewProps = {
  owner: "octocat",
  packageName: "demo-plugin",
  version: "1.0.0",
  validationUrl: "https://clawhub.ai/plugins/demo-plugin#validation",
  preheader: "ClawHub validated demo-plugin@1.0.0 against the upcoming OpenClaw release.",
} satisfies PluginInspectorFindingsEmailProps;
