import { createFileRoute, Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Banknote,
  Ban,
  CheckCircle2,
  Drama,
  Eye,
  EyeOff,
  ImageOff,
  ShieldCheck,
  ShieldOff,
  UserX,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { getSiteMode, getSiteName, getSiteUrlForMode } from "../lib/site";

export function renderWithInlineCode(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="about-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const prohibitedCategories: { title: string; icon: LucideIcon; examples: string }[] = [
  {
    title: "Bypass and unauthorized access",
    icon: ShieldOff,
    examples:
      "Auth bypass, account takeover, CAPTCHA bypass, Cloudflare or anti-bot evasion, rate-limit bypass, reusable session theft, live call or agent takeover.",
  },
  {
    title: "Platform abuse and ban evasion",
    icon: UserX,
    examples:
      "Stealth accounts after bans, account warming/farming, fake engagement, multi-account automation, spam posting, marketplace or social automation built to avoid detection.",
  },
  {
    title: "Fraud and deception",
    icon: Banknote,
    examples:
      "Fake certificates, fake invoices, deceptive payment flows, fake social proof, scam outreach, or synthetic-identity workflows built to create accounts for fraud.",
  },
  {
    title: "Privacy-invasive surveillance",
    icon: Eye,
    examples:
      "Mass contact scraping for spam, doxxing, stalking, covert monitoring, biometric / face-matching workflows without clear consent, or buying, publishing, downloading, or operationalizing leaked data or breach dumps.",
  },
  {
    title: "Non-consensual impersonation",
    icon: Drama,
    examples:
      "Face swap, digital twins, cloned influencers, fake personas, or other identity manipulation used to impersonate or mislead.",
  },
  {
    title: "Explicit sexual content",
    icon: ImageOff,
    examples:
      "NSFW image, video, or text generation, especially wrappers around third-party APIs with safety checks disabled.",
  },
  {
    title: "Hidden or misleading execution",
    icon: EyeOff,
    examples:
      "Obfuscated install commands, `curl | sh`, undeclared secret requirements, undeclared private-key use, or remote `npx @latest` execution without reviewability.",
  },
];

const acceptedPatterns = [
  "Frontend and design-system work that uses real components, semantic tokens, accessible states, and tested user flows.",
  "shadcn/ui composition that uses installed source components, project aliases, and documented variants instead of one-off markup.",
  "UI5 JavaScript-to-TypeScript conversion that preserves comments, uses concrete UI5 types, and keeps generated control interfaces reviewable.",
  "Defensive security review, moderation tooling, and abuse-detection prompts that show evidence and keep human approval boundaries clear.",
  "Consent-based workflow automation for personal or team accounts with explicit credentials, transparent setup, and dry-run or preview modes.",
  "Docs, migration runbooks, local developer utilities, and test fixtures scoped to the repository they support.",
];

const rejectedPatterns = [
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
    <main className="section about-page">
      <div className="about-bento">
        <section className="about-panel about-panel-hero">
          <div className="about-hero-copy">
            <div className="skill-card-tags mb-3">
              <Badge>About</Badge>
              <Badge variant="accent">Policy</Badge>
            </div>
            <h1 className="about-title">What ClawHub will not host</h1>
            <p className="about-lead">
              ClawHub is for useful, reviewable agent tooling. Skills that improve developer
              workflows, migrations, security review, or product implementation belong here. Abuse
              workflows do not.
            </p>
          </div>
        </section>

        <aside className="about-panel about-panel-callout">
          <div className="about-callout">
            <span className="about-callout-label">Moderation stance</span>
            <p>
              We judge end-to-end abuse patterns, not keyword theater. Useful tooling stays.
              Predatory workflows get removed.
            </p>
          </div>
        </aside>

        <section className="about-panel about-panel-categories">
          <div className="home-section-header">
            <h2 className="home-section-title">Rejection Categories</h2>
          </div>
          <div className="about-grid">
            {prohibitedCategories.map((category) => {
              const Icon = category.icon;
              return (
                <Card key={category.title} className="about-rule-card">
                  <CardHeader className="about-rule-card-header">
                    <div className="about-rule-card-icon">
                      <Icon />
                    </div>
                    <CardTitle>{category.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p>{renderWithInlineCode(category.examples)}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="about-panel about-panel-patterns">
          <div className="about-patterns-header">
            <div className="skill-card-tags">
              <Badge variant="success">Okay</Badge>
              <Badge variant="destructive">Not okay</Badge>
            </div>
            <h2 className="home-section-title">Recent patterns we are explicitly okay with</h2>
            <p className="about-panel-copy">
              The line is intent and execution. Reviewable tooling for real work stays; tooling
              optimized for evasion, deception, or non-consensual use gets rejected.
            </p>
          </div>
          <div className="about-pattern-lanes">
            <Card className="about-pattern-lane about-pattern-lane-accepted">
              <CardHeader className="about-pattern-lane-header">
                <div className="about-rule-card-icon">
                  <CheckCircle2 />
                </div>
                <div>
                  <Badge variant="success">Allowed</Badge>
                  <CardTitle>Useful, consent-based tooling</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="about-patterns">
                {acceptedPatterns.map((pattern) => (
                  <div key={pattern} className="about-pattern about-pattern-accepted">
                    <ShieldCheck />
                    <span>{pattern}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="about-pattern-lane about-pattern-lane-rejected">
              <CardHeader className="about-pattern-lane-header">
                <div className="about-rule-card-icon">
                  <Ban />
                </div>
                <div>
                  <Badge variant="destructive">Rejected</Badge>
                  <CardTitle>Abuse workflows in disguise</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="about-patterns">
                {rejectedPatterns.map((pattern) => (
                  <div key={pattern} className="about-pattern about-pattern-rejected">
                    <ShieldOff />
                    <span>{pattern}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="about-panel about-panel-enforcement">
          <div>
            <span className="about-callout-label">Enforcement</span>
            <div className="management-sublist">
              <div className="management-subitem">
                We may hide, remove, or hard-delete violating skills.
              </div>
              <div className="management-subitem">
                We may revoke tokens, soft-delete associated content, and ban repeat or severe
                offenders.
              </div>
              <div className="management-subitem">
                We do not guarantee warning-first enforcement for obvious abuse.
              </div>
            </div>
          </div>
        </section>

        <section className="about-panel about-panel-actions">
          <span className="about-callout-label">Next steps</span>
          <p className="about-panel-copy">
            If you are reviewing a borderline workflow, use the reviewer doc. If you are browsing,
            stay in the public catalog.
          </p>
          <div className="skill-card-tags">
            <Button asChild variant="primary">
              <Link to="/skills">Browse Skills</Link>
            </Button>
            <Button asChild>
              <a
                href="https://github.com/openclaw/clawhub/blob/main/docs/acceptable-usage.md"
                target="_blank"
                rel="noreferrer"
              >
                Reviewer Doc
              </a>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
