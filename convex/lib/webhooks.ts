export type WebhookEvent = 'skill.publish' | 'skill.highlighted'

export type WebhookSkillPayload = {
  slug: string
  displayName: string
  summary?: string
  version?: string
  ownerHandle?: string
  highlighted?: boolean
  tags?: string[]
}

export type WebhookConfig = {
  url: string | null
  highlightedOnly: boolean
  siteUrl: string
}

const DEFAULT_SITE_URL = 'https://clawhub.ai'

export function getWebhookConfig(env: NodeJS.ProcessEnv = process.env): WebhookConfig {
  const url = env.DISCORD_WEBHOOK_URL?.trim() || null
  const highlightedOnly = parseBoolean(env.DISCORD_WEBHOOK_HIGHLIGHTED_ONLY)
  const siteUrl = env.SITE_URL?.trim() || DEFAULT_SITE_URL
  return { url, highlightedOnly, siteUrl }
}

export function shouldSendWebhook(
  event: WebhookEvent,
  skill: WebhookSkillPayload,
  config: WebhookConfig,
) {
  if (!config.url) return false
  if (!config.highlightedOnly) return true
  if (event === 'skill.highlighted') return true
  return Boolean(skill.highlighted)
}

export function buildDiscordPayload(
  event: WebhookEvent,
  skill: WebhookSkillPayload,
  config: WebhookConfig,
) {
  const titleBase = skill.displayName || skill.slug
  const title = event === 'skill.highlighted' ? `Highlighted: ${titleBase}` : titleBase
  const description = buildDescription(event, skill)
  const url = buildSkillUrl(skill, config.siteUrl)
  const tags = formatTags(skill.tags)

  return {
    embeds: [
      {
        title,
        description,
        url,
        color: event === 'skill.highlighted' ? 0xff6b4a : 0x2f76ff,
        fields: [
          {
            name: 'Version',
            value: skill.version ? `v${skill.version}` : '—',
            inline: true,
          },
          {
            name: 'Owner',
            value: skill.ownerHandle ? `@${skill.ownerHandle}` : '—',
            inline: true,
          },
          {
            name: 'Tags',
            value: tags,
            inline: false,
          },
        ],
        footer: {
          text: 'ClawHub',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  }
}

export function buildSkillUrl(skill: WebhookSkillPayload, siteUrl: string) {
  const owner = skill.ownerHandle?.trim()
  if (owner) return `${siteUrl}/${owner}/${skill.slug}`
  return `${siteUrl}/skills/${skill.slug}`
}

function buildDescription(event: WebhookEvent, skill: WebhookSkillPayload) {
  const summary = (skill.summary ?? '').trim()
  if (summary) return truncate(summary, 200)
  if (event === 'skill.highlighted') return 'Newly highlighted skill on ClawHub.'
  if (skill.version) return `New version v${skill.version} published on ClawHub.`
  return 'New skill published on ClawHub.'
}

function parseBoolean(value?: string) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

function formatTags(tags?: string[] | null) {
  const cleaned = (tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  if (cleaned.length === 0) return '—'
  return cleaned.slice(0, 8).join(', ')
}

function truncate(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, max - 1).trim()}…`
}
