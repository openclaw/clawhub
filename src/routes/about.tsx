import { createFileRoute, Link } from '@tanstack/react-router';
import { getSiteMode, getSiteName, getSiteUrlForMode } from '../lib/site';

const prohibitedCategories = [
  {
    title: 'Bypass and unauthorized access',
    examples:
      'Auth bypass, account takeover, CAPTCHA bypass, Cloudflare or anti-bot evasion, rate-limit bypass, reusable session theft, live call or agent takeover.',
  },
  {
    title: 'Platform abuse and ban evasion',
    examples:
      'Stealth accounts after bans, account warming/farming, fake engagement, multi-account automation, spam posting, marketplace or social automation built to avoid detection.',
  },
  {
    title: 'Fraud and deception',
    examples:
      'Fake certificates, fake invoices, deceptive payment flows, fake social proof, scam outreach, or synthetic-identity workflows built to create accounts for fraud.',
  },
  {
    title: 'Privacy-invasive surveillance',
    examples:
      'Mass contact scraping for spam, doxxing, stalking, covert monitoring, biometric / face-matching workflows without clear consent, or buying, publishing, downloading, or operationalizing leaked data or breach dumps.',
  },
  {
    title: 'Non-consensual impersonation',
    examples:
      'Face swap, digital twins, cloned influencers, fake personas, or other identity manipulation used to impersonate or mislead.',
  },
  {
    title: 'Explicit sexual content',
    examples:
      'NSFW image, video, or text generation, especially wrappers around third-party APIs with safety checks disabled.',
  },
  {
    title: 'Hidden or misleading execution',
    examples:
      'Obfuscated install commands, `curl | sh`, undeclared secret requirements, undeclared private-key use, or remote `npx @latest` execution without reviewability.',
  },
];

const recentPatterns = [
  'Create stealth seller accounts after marketplace bans.',
  'Modify Telegram pairing so unapproved users automatically receive pairing codes.',
  'Cultivate Reddit or Twitter accounts with undetectable automation.',
  'Generate professional certificates or invoices for arbitrary use.',
  'Generate NSFW content with safety checks disabled.',
  'Scrape leads, enrich contacts, and launch cold outreach at scale.',
  'Buy, publish, or download leaked data or breach dumps.',
  'Bulk-create email or social accounts with synthetic identities or CAPTCHA solving.',
];

export const Route = createFileRoute('/about')({
  head: () => {
    const mode = getSiteMode();
    const siteName = getSiteName(mode);
    const siteUrl = getSiteUrlForMode(mode);
    const title = `About · ${siteName}`;
    const description =
      'What ClawHub allows, what we do not host, and the abuse patterns that lead to removal or account bans.';

    return {
      links: [
        {
          rel: "canonical",
          href: `${siteUrl}/about`,
        },
      ],
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:url', content: `${siteUrl}/about` },
      ],
    };
  },
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="section about-page">
      <div className="about-hero">
        <div className="about-hero-copy">
          <div className="skill-card-tags" style={{ marginBottom: 12 }}>
            <span className="tag">About</span>
            <span className="tag tag-accent">Policy</span>
          </div>
          <h1 className="about-title">What ClawHub will not host</h1>
          <p className="about-lead">
            ClawHub is for useful agent tooling, not abuse workflows. If a skill is built to evade
            defenses, scam people, invade privacy, or enable non-consensual behavior, it does not
            belong here.
          </p>
        </div>
        <div className="about-callout">
          <span className="about-callout-label">Moderation stance</span>
          <p>
            We judge end-to-end abuse patterns, not keyword theater. Useful tooling stays.
            Predatory workflows get removed.
          </p>
        </div>
      </div>

      <section className="about-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Immediate rejection categories</h2>
        </div>
        <div className="about-grid">
          {prohibitedCategories.map((category) => (
            <article key={category.title} className="about-rule-card">
              <h2>{category.title}</h2>
              <p>{category.examples}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="about-section">
        <div className="home-section-header">
          <h2 className="home-section-title">Recent patterns we are explicitly not okay with</h2>
        </div>
        <div className="about-patterns">
          {recentPatterns.map((pattern) => (
            <div key={pattern} className="about-pattern">
              {pattern}
            </div>
          ))}
        </div>
      </section>

      <section className="about-enforcement">
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
        <div className="skill-card-tags">
          <Link className="btn btn-primary" to="/skills">
            Browse Skills
          </Link>
          <a
            className="btn"
            href="https://github.com/openclaw/clawhub/blob/main/docs/acceptable-usage.md"
            target="_blank"
            rel="noreferrer"
          >
            Reviewer Doc
          </a>
        </div>
      </section>
    </main>
  );
}
