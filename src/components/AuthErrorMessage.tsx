import {
  ACCOUNT_APPEAL_LINK_TEXT,
  ACCOUNT_APPEAL_URL,
  CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT,
  CLAWHUB_ACCOUNT_ISSUE_URL,
} from "../lib/authErrorMessage";

export function AuthErrorMessage({ message }: { message: string }) {
  const link =
    message.indexOf(ACCOUNT_APPEAL_LINK_TEXT) === -1
      ? { text: CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT, href: CLAWHUB_ACCOUNT_ISSUE_URL }
      : { text: ACCOUNT_APPEAL_LINK_TEXT, href: ACCOUNT_APPEAL_URL };

  const linkStart = message.indexOf(link.text);
  if (linkStart === -1) return <>{message}</>;

  const before = message.slice(0, linkStart);
  const after = message.slice(linkStart + link.text.length);

  return (
    <>
      {before}
      <a
        href={link.href}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-2"
      >
        {link.text}
      </a>
      {after}
    </>
  );
}
