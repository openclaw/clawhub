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
  policyReasonItems?: string[];
  preheader: string;
};

export default function AccountSuspendedEmail({
  handle = "your account",
  suspendedAt,
  hiddenArtifacts,
  findingSummary,
  policyReasonItems = [],
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
      {policyReasonItems.length > 0 ? (
        <DetailList title="Policy signals" items={policyReasonItems} />
      ) : null}
      <DetailList
        title="What changed"
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

function DetailList({ title, items }: { title: string; items: string[] }) {
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
        {title}
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
  handle: "@bulkpub",
  suspendedAt: "2026-06-16 17:36 UTC",
  hiddenArtifacts: 42,
  findingSummary:
    "Your account was identified by ClawHub's publisher abuse review workflow for activity that appears inconsistent with our Acceptable Usage policy.",
  policyReasonItems: [
    "Bulk or spam publishing of large numbers of low-effort, duplicative, placeholder, or machine-generated listings.",
    "Publishing large catalogs with little or no usage, maintenance, source clarity, or meaningful differentiation.",
    "Artificially inflating installs, downloads, stars, or other engagement metrics.",
    "Abnormal download activity with little or no corresponding install activity.",
  ],
  preheader:
    "Your account has been suspended after publisher abuse review. Login is blocked, API tokens were revoked, and published artifacts may be hidden.",
} satisfies AccountSuspendedEmailProps;
