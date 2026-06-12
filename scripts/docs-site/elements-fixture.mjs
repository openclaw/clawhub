export const elementsFixture = `---
title: "Docs elements"
summary: "Hidden fixture page for docs shell visual QA."
status: "visual fixture"
applies_to: "docs shell"
beta: true
---

# Docs elements

This hidden page exercises the docs shell renderer. It is not linked from navigation, the sitemap, or the docs index.

## Text and inline code

OpenClaw docs use compact developer prose with **strong emphasis**, [inline links](/start/getting-started), inline code such as \`openclaw onboard\`, and <Tooltip tip="JSON5 supports comments and trailing commas">**tooltip text**</Tooltip>.

Feature labels stay inline: <Badge color="orange">Beta</Badge> <Badge color="green">Stable</Badge>

> Blockquotes should stay quiet and readable without becoming callout boxes.

### Heading level three

Use h3 sections for local structure inside a major task.

#### Heading level four

Use h4 sections sparingly for small reference clusters.

- Unordered lists should stay compact.
- List items can include \`inline code\`, **strong text**, and links.
  - Nested items should not collide with surrounding rhythm.

1. Ordered lists should keep readable spacing.
2. They should not look like step components.

Keyboard hints such as <kbd>⌘</kbd><kbd>K</kbd> should render as small controls.

## Callouts

<Tip>
Use tips for shortcuts that save setup time without changing the required path.
</Tip>

<Info>
Use info notices for contextual details that help readers choose the right route.
</Info>

<Note>
Use notes for extra constraints that matter but are not urgent.
</Note>

<Warning>
Use warnings for mistakes that can break auth, leak secrets, or leave a Gateway unreachable.
</Warning>

<Check>
Use check callouts to confirm a successful state after setup.
</Check>

<Say>
Use say callouts for exact text a reader can send to an agent or channel.
</Say>

<Banner>
Use banners for short page-level state such as beta guidance, migration notices, or temporary service notes.
</Banner>

<Update>
Use updates for recent behavior changes that matter to returning readers.
</Update>

## Code

\`\`\`ts scripts/docs-site/example.ts lines {4,10} focus=3-11
type GatewayMode = "local" | "remote";

export async function restartGateway(mode: GatewayMode) {
  const command = mode === "remote"
    ? "openclaw gateway restart --remote"
    : "openclaw gateway restart";

  const result = await run(command, { timeoutMs: 30_000 });
  if (!result.ok) throw new Error(result.stderr);

  return {
    mode,
    status: "restarted",
    checkedAt: new Date().toISOString(),
  };
}
\`\`\`

\`\`\`bash expandable
openclaw status --deep
openclaw gateway inspect --json
openclaw channels list
openclaw channels test telegram
openclaw channels test slack
openclaw models list
openclaw models test openai
openclaw models test anthropic
openclaw plugins list
openclaw plugins doctor
openclaw skills list
openclaw skills validate
openclaw config get gateway.publicBaseUrl
openclaw config get gateway.heartbeatSeconds
openclaw config get channels.telegram.enabled
openclaw config get channels.telegram.groupPolicy
openclaw config get channels.slack.enabled
openclaw config get channels.slack.socketMode
openclaw logs tail gateway
openclaw logs tail channels
openclaw gateway restart
openclaw gateway health
openclaw gateway doctor
openclaw status --deep
\`\`\`

<CodeGroup>

\`\`\`sh scripts/setup-openclaw.sh
#!/usr/bin/env bash
set -euo pipefail

openclaw status --deep
openclaw gateway restart

curl -fsSL https://docs.openclaw.ai/llms.txt \\
  | sed -n '1,16p'
\`\`\`

\`\`\`json5 openclaw.json5
{
  // Keep the docs fixture close to real Gateway config.
  "channels": {
    "telegram": {
      "enabled": true,
      "groupPolicy": "allowlist",
      "requireMention": true,
    }
  },
  "gateway": {
    "publicBaseUrl": "https://gateway.example.com",
    "heartbeatSeconds": 30,
  }
}
\`\`\`

</CodeGroup>

<Prompt title="Agent prompt">
Summarize the active OpenClaw Gateway health and include the exact command that proves it.
</Prompt>

## Cards

<CardGroup cols={3}>
  <Card title="Get started" href="/start/getting-started" icon="rocket">
    Install OpenClaw, run onboarding, and read SKILL.md without implicit links.
  </Card>
  <Card title="Gateway config" href="/gateway/configuration" icon="gear">
    Configure auth, channels, models, and runtime defaults.
  </Card>
  <Card title="Troubleshooting" href="/help/troubleshooting" icon="wrench">
    Diagnose startup, auth, channel, and provider issues.
  </Card>
  <Card title="Plugin SDK" href="/plugins/sdk" icon="book">
    Build plugin surfaces using the public SDK contracts.
  </Card>
  <Card title="Configuration" href="/gateway/configuration" icon="settings">
    Review production defaults and channel-specific overrides.
  </Card>
  <Card title="Remote access" href="/gateway/remote" icon="globe">
    Expose the Gateway safely when a channel needs inbound webhooks.
  </Card>
</CardGroup>

<CardGroup cols={1}>
  <Card title="Single column" href="/help/troubleshooting" icon="terminal">
    One-column cards should stay intentionally narrow rather than joining an auto-fit row.
  </Card>
</CardGroup>

<CardGroup cols={2}>
  <Card title="Two-column A" href="/start/showcase" icon="layout-dashboard">
    Mirrors the showcase contract that should not grow into three columns.
  </Card>
  <Card title="Two-column B" href="/start/showcase" icon="layout-dashboard">
    Keeps paired decision cards aligned on desktop.
  </Card>
  <Card title="Two-column C" href="/start/showcase" icon="layout-dashboard">
    Wraps to the next row without changing the requested column count.
  </Card>
  <Card title="Two-column D" href="/start/showcase" icon="layout-dashboard">
    Gives visual smoke enough items to count row geometry.
  </Card>
</CardGroup>

<CardGroup cols={4}>
  <Card title="Four-column A" href="/plugins" icon="sparkles">
    Compact card.
  </Card>
  <Card title="Four-column B" href="/plugins" icon="sparkles">
    Compact card.
  </Card>
  <Card title="Four-column C" href="/plugins" icon="sparkles">
    Compact card.
  </Card>
  <Card title="Four-column D" href="/plugins" icon="sparkles">
    Compact card.
  </Card>
</CardGroup>

## Columns

<Columns>
  <Card title="Channel guide" href="/channels" icon="globe">
    Compare channel setup paths without changing the page rhythm.
  </Card>
  <Card title="Model guide" href="/models" icon="sparkles">
    Keep adjacent cards aligned when content lengths differ.
  </Card>
</Columns>

<Columns cols={4}>
  <Card title="Column A" href="/models" icon="settings">
    Honors explicit Columns attrs too.
  </Card>
  <Card title="Column B" href="/models" icon="settings">
    Honors explicit Columns attrs too.
  </Card>
  <Card title="Column C" href="/models" icon="settings">
    Honors explicit Columns attrs too.
  </Card>
  <Card title="Column D" href="/models" icon="settings">
    Honors explicit Columns attrs too.
  </Card>
</Columns>

## Tiles and panels

<Snippet file="./snippet-fixture.md" />

<TileGroup>
  <Tile title="Release notes" href="/releases" icon="book">
    Compact routing links should work without becoming another full card grid.
  </Tile>
  <Tile title="Gateway ops" href="/gateway" icon="terminal">
    Tiles are useful for dense secondary navigation.
  </Tile>
</TileGroup>

<Panel title="Reusable guidance">
Panels hold short reusable docs fragments without looking like alerts.
</Panel>

## Editorial elements

<Lead>
Use lead text for blog posts, release writeups, and opinionated setup guides where the opening paragraph needs more presence than normal body copy.
</Lead>

<PullQuote cite="OpenClaw docs editorial rule">
Show the operational consequence, not just the feature name.
</PullQuote>

<StatGrid>
  <Stat value="4m" label="median setup check" delta="-32%">
    Good for lightweight outcome summaries inside a post.
  </Stat>
  <Stat value="19" label="localized docs trees" />
  <Stat value="0" label="indexed hidden fixtures" delta="expected" />
</StatGrid>

<Chart type="bar" title="Docs reader paths" subtitle="example fixture" unit="%">
Install,42
Channels,28
Models,18
Plugins,12
</Chart>

<Chart type="line" title="Beta adoption" subtitle="illustrative weekly trend" labels="Mon,Tue,Wed,Thu,Fri" values="12,18,24,31,39" unit="%" />

<Chart type="area" title="Docs deploy volume" subtitle="example weekly count" labels="Mon,Tue,Wed,Thu,Fri" values="16,24,22,37,48" />

<Chart type="donut" title="Support mix" subtitle="example issue categories">
Install,31
Gateway,27
Channels,24
Providers,18
</Chart>

<CTA title="Build the next plugin guide" eyebrow="Authoring flow" href="/plugins/sdk" label="Open SDK docs" secondaryHref="/tools/skills" secondaryLabel="Review skills">
Use a CTA when a long-form article has one obvious next action. Keep it specific.
</CTA>

<CTAGroup>
  <CTACard title="Release post template" href="/releases" label="Read notes" icon="book" kicker="Blog pattern">
    CTA cards work for related posts, migration paths, and follow-up reading.
  </CTACard>
  <CTACard title="Gateway checklist" href="/gateway/configuration" label="Open checklist" icon="terminal" kicker="Ops pattern">
    Keep action cards denser than product marketing cards.
  </CTACard>
</CTAGroup>

## Steps

<Steps>
  <Step title="Install OpenClaw">
    Run the installer and verify Node is available.

    \`\`\`sh
    curl -fsSL https://openclaw.ai/install.sh | bash
    \`\`\`

    Continue with the next command only after the installer exits cleanly.
  </Step>
  <Step title="Run onboarding">
    Pair a channel and choose a model provider.
  </Step>
  <Step title="Verify the Gateway">
    Confirm the Gateway responds before adding more channels.
  </Step>
</Steps>

## Tabs

<Tabs>
  <Tab title="macOS / Linux">
    \`\`\`sh
    openclaw onboard
    \`\`\`
  </Tab>
  <Tab title="Windows">
    \`\`\`powershell
    openclaw.exe onboard
    \`\`\`
  </Tab>
</Tabs>

## Accordions

<AccordionGroup>
  <Accordion title="What should be visible?">
    Accordion summaries should be scannable, and their body text should not look like nested cards.
  </Accordion>
  <Expandable title="What can be expanded?">
    Expandables use the same quiet disclosure treatment as accordions.
  </Expandable>
  <Accordion title="What should stay quiet?">
    Long reference details should remain readable without stealing attention from the surrounding page.
  </Accordion>
</AccordionGroup>

## Parameters

<ParamField path="channels.telegram.groupPolicy" type="string" required>
Controls whether Telegram groups use allowlists, denylists, or open access.
</ParamField>

<ParamField path="channels.telegram.requireMention" type="boolean" default="true">
Controls whether group messages need to mention the agent before a reply is considered.
</ParamField>

<ParamField path="channels.telegram.accounts" type="record">
Defines multiple Telegram account profiles for the same Gateway.
</ParamField>

<Property name="session.status" type="enum" default="idle">
Property blocks share the parameter renderer for config, response, and schema details.
</Property>

<ResponseField name="ok" type="boolean" required>
Response fields use the same dense reference layout.
</ResponseField>

## Diagram

<Mermaid>
sequenceDiagram
  participant User
  participant Gateway
  User->>Gateway: openclaw status
  Gateway-->>User: healthy
</Mermaid>

\`\`\`mermaid
flowchart LR
  A["Ready<br>state"] --> B["Rendered"]
\`\`\`

<Mermaid>
flowchart LR
  Broken -->
</Mermaid>

## Frame

<Frame caption="OpenClaw docs frame">
  ![OpenClaw pixel lobster](/assets/pixel-lobster.svg)
</Frame>

## Table

| Surface | Purpose | Status |
| --- | --- | --- |
| R2 Pages | Static object deploy | Healthy |
| Docs Live Smoke | Production route probe | Healthy |
| Pages | Worker router validation | Manual deploy |
`;
