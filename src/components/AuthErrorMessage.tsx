import {
  CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT,
  CLAWHUB_ACCOUNT_ISSUE_URL,
} from "../lib/authErrorMessage";

export function AuthErrorMessage({ message }: { message: string }) {
  const linkStart = message.indexOf(CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT);
  if (linkStart === -1) return <>{message}</>;

  const before = message.slice(0, linkStart);
  const after = message.slice(linkStart + CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT.length);

  return (
    <>
      {before}
      <a
        href={CLAWHUB_ACCOUNT_ISSUE_URL}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-2"
      >
        {CLAWHUB_ACCOUNT_ISSUE_LINK_TEXT}
      </a>
      {after}
    </>
  );
}
