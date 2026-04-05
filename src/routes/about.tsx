import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Shield, ShieldAlert } from "lucide-react";
import { Container } from "../components/layout/Container";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Separator } from "../components/ui/separator";
import { getSiteMode, getSiteName, getSiteUrlForMode } from "../lib/site";

const prohibitedCategories = [
  {
    title: "Bypass and unauthorized access",
    examples:
      "Auth bypass, account takeover, CAPTCHA bypass, Cloudflare or anti-bot evasion, rate-limit bypass, reusable session theft, live call or agent takeover.",
  },
  {
    title: "Platform abuse and ban evasion",
    examples:
      "Stealth accounts after bans, account warming/farming, fake engagement, multi-account automation, spam posting, marketplace or social automation built to avoid detection.",
  },
  {
    title: "Fraud and deception",
    examples:
      "Fake certificates, fake invoices, deceptive payment flows, fake social proof, scam outreach, or synthetic-identity workflows built to create accounts for fraud.",
  },
  {
    title: "Privacy-invasive surveillance",
    examples:
      "Mass contact scraping for spam, doxxing, stalking, covert monitoring, biometric / face-matching workflows without clear consent, or buying, publishing, downloading, or operationalizing leaked data or breach dumps.",
  },
  {
    title: "Non-consensual impersonation",
    examples:
      "Face swap, digital twins, cloned influencers, fake personas, or other identity manipulation used to impersonate or mislead.",
  },
  {
    title: "Explicit sexual content",
    examples:
      "NSFW image, video, or text generation, especially wrappers around third-party APIs with safety checks disabled.",
  },
  {
    title: "Hidden or misleading execution",
    examples:
      "Obfuscated install commands, `curl | sh`, undeclared secret requirements, undeclared private-key use, or remote `npx @latest` execution without reviewability.",
  },
];

const recentPatterns = [
  "Create stealth seller accounts after marketplace bans.",
  "Modify Telegram pairing so unapproved users automatically receive pairing codes.",
  "Cultivate Reddit or Twitter accounts with undetectable automation.",
  "Generate professional certificates or invoices for arbitrary use.",
  "Generate NSFW content with safety checks disabled.",
  "Scrape leads, enrich contacts, and launch cold outreach at scale.",
  "Buy, publish, or download leaked data or breach dumps.",
  "Bulk-create email or social accounts with synthetic identities or CAPTCHA solving.",
];

export const Route = createFileRoute("/about")({
  head: () => {
    const mode = getSiteMode();
    const siteName = getSiteName(mode);
    const siteUrl = getSiteUrlForMode(mode);
    const title = `About · ${siteName}`;
    const description =
      "What ClawHub allows, what we do not host, and the abuse patterns that lead to removal or account bans.";

    return {
      links: [
        {
          rel: "canonical",
          href: `${siteUrl}/about`,
        },
      ],
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: `${siteUrl}/about` },
      ],
    };
  },
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="py-10">
      <Container size="narrow">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex flex-wrap gap-2">
                <Badge>About</Badge>
                <Badge variant="accent">Policy</Badge>
              </div>
              <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
                What ClawHub Will Not Host
              </h1>
              <p className="text-sm leading-relaxed text-[color:var(--ink-soft)]">
                ClawHub is for useful agent tooling, not abuse workflows. If a skill is built to
                evade defenses, abuse platforms, scam people, invade privacy, or enable
                non-consensual behavior, it does not belong here.
              </p>
              <div className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm font-medium text-[color:var(--ink-soft)]">
                <Shield className="h-4 w-4 shrink-0 text-[color:var(--accent)]" />
                We moderate based on end-to-end abuse patterns, not just isolated keywords.
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
            {prohibitedCategories.map((category) => (
              <Card key={category.title}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-[color:var(--gold)]" />
                    {category.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-relaxed text-[color:var(--ink-soft)]">
                    {category.examples}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[color:var(--gold)]" />
                Recent patterns we are explicitly not okay with
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {recentPatterns.map((pattern) => (
                  <li
                    key={pattern}
                    className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-3 text-sm text-[color:var(--ink-soft)]"
                  >
                    <span className="mt-0.5 shrink-0 text-[color:var(--gold)]" aria-hidden="true">
                      -
                    </span>
                    {pattern}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Enforcement</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ul className="flex flex-col gap-2">
                <li className="flex items-start gap-2 text-sm text-[color:var(--ink-soft)]">
                  <span className="mt-0.5 shrink-0 text-[color:var(--accent)]" aria-hidden="true">
                    1.
                  </span>
                  We may hide, remove, or hard-delete violating skills.
                </li>
                <li className="flex items-start gap-2 text-sm text-[color:var(--ink-soft)]">
                  <span className="mt-0.5 shrink-0 text-[color:var(--accent)]" aria-hidden="true">
                    2.
                  </span>
                  We may revoke tokens, soft-delete associated content, and ban repeat or severe
                  offenders.
                </li>
                <li className="flex items-start gap-2 text-sm text-[color:var(--ink-soft)]">
                  <span className="mt-0.5 shrink-0 text-[color:var(--accent)]" aria-hidden="true">
                    3.
                  </span>
                  We do not guarantee warning-first enforcement for obvious abuse.
                </li>
              </ul>
              <Separator />
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/skills"
                  search={{
                    q: undefined,
                    sort: undefined,
                    dir: undefined,
                    highlighted: undefined,
                    nonSuspicious: undefined,
                    view: undefined,
                    focus: undefined,
                  }}
                >
                  <Button variant="primary">Browse Skills</Button>
                </Link>
                <a
                  href="https://github.com/openclaw/clawhub/blob/main/docs/acceptable-usage.md"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Button variant="outline">Reviewer Doc</Button>
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </Container>
    </main>
  );
}
