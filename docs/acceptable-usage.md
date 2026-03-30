---
summary: "Marketplace policy: what ClawHub will not allow."
read_when:
  - Reviewing uploads for abuse or policy violations
  - Writing moderation docs or reviewer runbooks
  - Deciding whether a skill should be hidden or a user banned
---

# Acceptable Usage

This page describes the kinds of skills and content ClawHub is not okay with.

These rules are intentionally practical. We care most about end-to-end abuse workflows, not just isolated keywords. If a skill is built to evade defenses, abuse platforms, scam people, invade privacy, or enable non-consensual behavior, it does not belong on ClawHub.

## Not okay

- Security-bypass or unauthorized-access workflows.
  - Examples: auth bypass, account takeover, CAPTCHA bypass, Cloudflare or anti-bot evasion, rate-limit bypass, stealth scraping designed to defeat protections, live call or agent takeover, reusable session theft, auto-approving pairing flows for unapproved users.

- Platform abuse and ban evasion.
  - Examples: stealth accounts after bans, account warming/farming, fake engagement, karma or follower cultivation, multi-account automation, mass posting, spam bots, marketplace or social automation built to avoid detection.

- Fraud, scams, and deceptive financial workflows.
  - Examples: fake certificates, fake invoices, deceptive payment flows, scam outreach, fake social proof, tools that enable spending or charging without clear human approval and transparent controls, or synthetic-identity workflows built to create accounts for fraud.

- Privacy-invasive scraping, enrichment, or surveillance.
  - Examples: scraping contact details at scale for spam, doxxing, stalking, lead extraction paired with unsolicited outreach, covert monitoring, face search or biometric matching used without clear consent, or buying, publishing, downloading, or operationalizing leaked data or breach dumps.

- Non-consensual impersonation or deceptive identity manipulation.
  - Examples: face swap, digital twins, fake personas, cloned influencers, or other identity-manipulation tooling used to impersonate or mislead.

- Explicit sexual content and safety-disabled adult generation.
  - Examples: NSFW image/video/content generation, adult-content wrappers around third-party APIs, or skills whose primary purpose is explicit sexual content.

- Hidden, unsafe, or misleading execution requirements.
  - Examples: obfuscated install commands, `curl | sh`, undeclared secret requirements, undeclared private-key use, remote `npx @latest` execution without clear reviewability, misleading metadata that hides what the skill really needs to run.

## Recent patterns we are explicitly not okay with

- “Create stealth seller accounts after marketplace bans.”
- “Modify Telegram pairing so unapproved users automatically receive pairing codes.”
- “Cultivate Reddit/Twitter accounts with undetectable automation.”
- “Generate professional certificates or invoices for arbitrary use.”
- “Generate NSFW content with safety checks disabled.”
- “Scrape leads, enrich contacts, and launch cold outreach at scale.”
- “Buy, publish, or download leaked data or breach dumps.”
- “Bulk-create email or social accounts with synthetic identities or CAPTCHA solving.”

## Notes for reviewers

- Context matters. The same topic can be legitimate in a narrow defensive or consent-based setting and unacceptable when packaged as an abuse workflow.
- We should bias toward action when a skill is clearly optimized for evasion, deception, or non-consensual use.
- Repeated uploads in these categories are grounds for hiding content and banning the account.

## Enforcement

- We may hide, remove, or hard-delete violating skills.
- We may revoke tokens, soft-delete associated content, and ban repeat or severe offenders.
- We do not guarantee warning-first enforcement for obvious abuse.
