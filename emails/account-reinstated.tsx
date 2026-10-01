import type { ReactNode } from "react";
import {
  Badge,
  ClawHubEmailLayout,
  DetailTable,
  EmailHeading,
  MonoPill,
  Paragraph,
} from "./_components/clawhub";

export type AccountReinstatedEmailProps = {
  handle?: string;
  restoredAt: string;
  skillsRestored?: number;
  packagesRestored?: number;
  preheader: string;
};

export default function AccountReinstatedEmail({
  handle = "your account",
  restoredAt,
  skillsRestored,
  packagesRestored,
  preheader,
}: AccountReinstatedEmailProps) {
  const rows: Array<[string, ReactNode]> = [
    ["Account", <MonoPill key="account">{handle}</MonoPill>],
  ];
  if (typeof skillsRestored === "number" && typeof packagesRestored === "number") {
    rows.push(["Skills restored", skillsRestored], ["Packages restored", packagesRestored]);
  }
  rows.push([
    "Reinstated on",
    <span key="reinstated" style={{ color: "#3fb950" }}>
      {restoredAt}
    </span>,
  ]);

  return (
    <ClawHubEmailLayout preview={preheader} railLabel="ACCOUNT REINSTATED" topColor="#3fb950">
      <Badge color="#3fb950">REINSTATED</Badge>
      <EmailHeading>Your account has been reinstated</EmailHeading>
      <Paragraph>
        Good news, <MonoPill>{handle}</MonoPill> - the suspension on your account has been lifted.
        You can log in again, and eligible published artifacts have been restored.
      </Paragraph>
      <DetailTable rows={rows} />
      <Paragraph>
        API tokens issued before the suspension remain revoked. Create new tokens before using API
        access again.
      </Paragraph>
    </ClawHubEmailLayout>
  );
}

AccountReinstatedEmail.PreviewProps = {
  handle: "@octocat",
  restoredAt: "2026-06-11 22:15 UTC",
  skillsRestored: 12,
  packagesRestored: 3,
  preheader:
    "Your account is active again - 12 skills and 3 packages restored. Previous API tokens remain revoked.",
} satisfies AccountReinstatedEmailProps;
