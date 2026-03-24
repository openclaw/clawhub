# ClawHub Publishing Guidelines

## Be Useful

Publish skills that solve a real problem. If your skill doesn't do something genuinely helpful, don't publish it. The registry isn't a dumping ground for half-baked experiments or placeholder listings.

## Be Honest

Your skill name and description should accurately reflect what it does. No clickbait titles, no overpromising, no vague nonsense like "Unlimited Free AI." If it reads PDFs, call it a PDF reader. Say what it does, simply and clearly.

## Be Safe

Don't publish skills that ask users to download external executables, paste obfuscated commands, or hand over credentials. Don't hardcode secrets. Don't request permissions your skill doesn't need. If VirusTotal flags your skill, fix the issue or contact security@openclaw.ai.

## Maintain Your Work

If you publish a skill, maintain it. Fix bugs, respond to feedback, update versions properly using semver, and write real changelogs. Abandoned skills that stop working erode trust in the whole registry.

## Play Fair

No typosquatting other people's skill names. No cloning popular skills with minor tweaks to farm downloads. No inflating your stats. No abusing the report system to sabotage others. No publishing the same skill under 10 different names.

## Crypto and Web3 Skills

Crypto skills receive the highest level of scrutiny. This category was the most heavily exploited during the ClawHavoc incident, with malicious skills disguised as wallet tools, trading bots, and token analytics to steal credentials and funds.

All crypto and Web3 related skills are placed on hold and require manual human review before going live on the registry. No crypto skill is auto-approved regardless of VirusTotal verdict. If it sounds scammy, overpromises returns, asks users to connect wallets or share private keys, or has no clear legitimate purpose, it's getting removed and the publishing account is permanently banned. No exceptions, no warnings.

## Moderation

- Every skill is automatically scanned by VirusTotal at publish and daily after that.
- Malicious skills are blocked instantly. Suspicious skills get a warning badge.
- Any user can report a skill. After 4 unique reports, it's auto-hidden pending review.
- Abusing reports or publishing malicious content will get you banned.
- Your GitHub account must be at least 7 days old to publish.

If your skill gets incorrectly flagged, email security@openclaw.ai. If you want to become a moderator, ask in the OpenClaw Discord.

For full documentation on building and publishing skills, see the [Skills docs](./skill-format.md), ClawHub docs, and Plugins docs.
