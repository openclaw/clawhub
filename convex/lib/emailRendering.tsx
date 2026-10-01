import { render, toPlainText } from "@react-email/render";
import type { ReactElement } from "react";
import AccountReinstatedEmail, {
  type AccountReinstatedEmailProps,
} from "../../emails/account-reinstated";
import AccountSuspendedEmail, {
  type AccountSuspendedEmailProps,
} from "../../emails/account-suspended";
import AdminOneOffEmail, { type AdminOneOffEmailProps } from "../../emails/admin-one-off";
import BlockedVersionEmail, { type BlockedVersionEmailProps } from "../../emails/blocked-version";
import PluginInspectorFindingsEmail, {
  type PluginInspectorFindingsEmailProps,
} from "../../emails/plugin-inspector-findings";
import SecretBlockedPublishEmail, {
  type SecretBlockedPublishEmailProps,
} from "../../emails/secret-blocked-publish";

export async function renderAccountSuspendedEmail(props: AccountSuspendedEmailProps) {
  return await renderEmail(<AccountSuspendedEmail {...props} />);
}

export async function renderAccountReinstatedEmail(props: AccountReinstatedEmailProps) {
  return await renderEmail(<AccountReinstatedEmail {...props} />);
}

export async function renderBlockedVersionEmail(props: BlockedVersionEmailProps) {
  return await renderEmail(<BlockedVersionEmail {...props} />);
}

export async function renderPluginInspectorFindingsEmail(props: PluginInspectorFindingsEmailProps) {
  return await renderEmail(<PluginInspectorFindingsEmail {...props} />);
}

export async function renderSecretBlockedPublishEmail(props: SecretBlockedPublishEmailProps) {
  return await renderEmail(<SecretBlockedPublishEmail {...props} />);
}

export async function renderAdminOneOffEmail(props: AdminOneOffEmailProps) {
  return await renderEmail(<AdminOneOffEmail {...props} />);
}

async function renderEmail(element: ReactElement) {
  const html = await render(element);
  return {
    html,
    text: toPlainText(html),
  };
}
