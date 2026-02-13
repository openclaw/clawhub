import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import { buildDiscordPayload, getWebhookConfig, shouldSendWebhook } from './lib/webhooks'

export const sendDiscordWebhook = internalAction({
  args: {
    event: v.union(v.literal('skill.publish'), v.literal('skill.highlighted')),
    skill: v.object({
      slug: v.string(),
      displayName: v.string(),
      summary: v.optional(v.string()),
      version: v.optional(v.string()),
      ownerHandle: v.optional(v.string()),
      highlighted: v.optional(v.boolean()),
      tags: v.optional(v.array(v.string())),
    }),
  },
  handler: async (_ctx, args) => {
    const config = getWebhookConfig()
    const logMeta = {
      event: args.event,
      slug: args.skill.slug,
      version: args.skill.version ?? null,
      highlighted: args.skill.highlighted ?? false,
      highlightedOnly: config.highlightedOnly,
    }
    if (!shouldSendWebhook(args.event, args.skill, config)) {
      console.info('[webhook] skipped', logMeta)
      return { ok: false, skipped: true }
    }

    const payload = buildDiscordPayload(args.event, args.skill, config)
    const response = await fetch(config.url as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const message = await response.text()
      console.error('[webhook] failed', {
        ...logMeta,
        status: response.status,
        body: message.slice(0, 300),
      })
      throw new Error(`Discord webhook failed: ${response.status} ${message}`)
    }
    console.info('[webhook] sent', { ...logMeta, status: response.status })
    return { ok: true }
  },
})
