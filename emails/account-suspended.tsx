import type { ReactNode } from "react";
import {
  ActionButton,
  APPEALS_URL,
  Badge,
  ClawHubEmailLayout,
  DetailTable,
  EmailHeading,
  MonoPill,
  Paragraph,
} from "./_components/clawhub";

export type AccountSuspendedEmailProps = {
  handle?: string;
  suspendedAt: string;
  hiddenArtifacts?: number;
  findingSummary: string;
  preheader: string;
};

export default function AccountSuspendedEmail({
  handle = "your account",
  suspendedAt,
  hiddenArtifacts,
  findingSummary,
  preheader,
}: AccountSuspendedEmailProps) {
  const rows: Array<[string, ReactNode]> = [
    ["Account", <MonoPill key="account">{handle}</MonoPill>],
    ["Suspended on", suspendedAt],
  ];
  if (typeof hiddenArtifacts === "number") rows.push(["Artifacts hidden", hiddenArtifacts]);
  rows.push([
    "Status",
    <span key="status" style={{ color: "#e8443a" }}>
      SUSPENDED
    </span>,
  ]);

  return (
    <ClawHubEmailLayout preview={preheader} railLabel="ACCOUNT SUSPENDED">
      <Badge>ACCOUNT SUSPENDED</Badge>
      <EmailHeading>Your account has been suspended</EmailHeading>
      <Paragraph>
        Your ClawHub account <MonoPill>{handle}</MonoPill> was suspended after moderation review.
      </Paragraph>
      <Paragraph>{findingSummary}</Paragraph>
      <ImpactList
        items={[
          "Your ClawHub account cannot sign in.",
          "Existing API tokens for the account have been revoked.",
          "Published listings owned by the account may be hidden from public view.",
        ]}
      />
      <DetailTable rows={rows} />
      <Paragraph>If you believe this decision is a mistake, you can submit an appeal.</Paragraph>
      <ActionButton href={APPEALS_URL}>Submit an appeal</ActionButton>
    </ClawHubEmailLayout>
  );
}

function ImpactList({ items }: { items: string[] }) {
  return (
    <>
      <h2
        style={{
          margin: "24px 0 10px",
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: "15px",
          color: "#f5f5f5",
        }}
      >
        What changed
      </h2>
      <ul
        style={{
          margin: 0,
          paddingLeft: "20px",
          fontFamily: "Helvetica, Arial, sans-serif",
          fontSize: "15px",
          lineHeight: "23px",
          color: "#a8a8ad",
        }}
      >
        {items.map((item) => (
          <li key={item} style={{ margin: "6px 0" }}>
            {item}
          </li>
        ))}
      </ul>
    </>
  );
}

AccountSuspendedEmail.PreviewProps = {
  handle: "@octocat",
  suspendedAt: "2026-06-11 21:32 UTC",
  hiddenArtifacts: 14,
  findingSummary: "ClawScan classified the uploaded skill as malicious.",
  preheader:
    "Your account has been suspended. Login is blocked, API tokens were revoked, and published artifacts may be hidden.",
} satisfies AccountSuspendedEmailProps;
