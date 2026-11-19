/* @vitest-environment node */
import { render, toPlainText } from "@react-email/render";
import { expect, it } from "vitest";
import TemplateNotPublishedEmail from "./template-not-published";
import TemplatePublishedEmail from "./template-published";

it("renders the approved public release receipt in HTML and plain text", async () => {
  const html = await render(<TemplatePublishedEmail {...TemplatePublishedEmail.PreviewProps} />);
  const text = toPlainText(html);
  expect(html).toMatch(/<h1[^>]*>Standup Prep is now public<\/h1>/);
  expect(text).toContain("Version 1.0.0 passed ClawHub’s security audit.");
  expect(text).toContain("@octocat/standup-prep");
  expect(html).toContain('href="https://clawhub.ai/octocat/templates/standup-prep"');
  expect(text).toMatch(/View your template/i);
  expect(text).toMatch(/Email preferences/i);
  expect(text).not.toMatch(/anyone can|to share|receiving this|template publication/i);
});

it("does not claim an audit passed without a clean audit", async () => {
  const html = await render(
    <TemplatePublishedEmail {...TemplatePublishedEmail.PreviewProps} auditPassed={false} />,
  );
  expect(toPlainText(html)).toContain("Version 1.0.0 is now available on ClawHub.");
  expect(html).not.toContain("passed ClawHub");
});

it.each([
  ["blocked", "flagged the contents of this upload as malicious", "corrected version"],
  ["scan_failed", "did not finish after three attempts", "not a rejection"],
] as const)(
  "explains %s without sending the publisher to an unpublished page",
  async (outcome, reason, next) => {
    const html = await render(
      <TemplateNotPublishedEmail {...TemplateNotPublishedEmail.PreviewProps} outcome={outcome} />,
    );
    const text = toPlainText(html);
    expect(text).toContain(reason);
    expect(text).toContain(next);
    expect(text).toContain("@octocat/standup-prep");
    expect(text).toContain("1.0.0");
    expect(text).not.toMatch(/View your template|View submission details|\/templates\//i);
  },
);
