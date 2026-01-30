/**
 * Extra seed skills for pagination testing.
 *
 * This file contains 50 placeholder skills to test pagination behavior.
 * Run with: bunx convex run internal.devSeedExtra.seedExtraSkillsInternal
 * Or with reset: bunx convex run internal.devSeedExtra.seedExtraSkillsInternal '{"reset": true}'
 */

import { v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import type { ActionCtx } from './_generated/server'
import { internalAction, internalMutation } from './_generated/server'
import { upsertResourceForSkill } from './lib/resource'
import { parseFrontmatter, parseMoltbotMetadata } from './lib/skills'

type SeedSkillSpec = {
  slug: string
  displayName: string
  summary: string
  version: string
  metadata: Record<string, unknown>
  rawSkillMd: string
}

function makeSkill(
  slug: string,
  displayName: string,
  summary: string,
  envVars: string[] = [],
  commands: string[] = ['help', 'status', 'run'],
): SeedSkillSpec {
  const cliHelp = `${slug} - ${summary}

Usage:
  ${slug} [command]

Commands:
${commands.map((cmd) => `  ${cmd.padEnd(12)} Run ${cmd} operation`).join('\n')}

Flags:
  -h, --help   Show help
  --json       Output as JSON
`

  const rawSkillMd = `---
name: ${slug}
description: ${summary}
---

# ${displayName}

## CLI

\`\`\`bash
${commands.map((cmd) => `${slug} ${cmd}`).join('\n')}
\`\`\`

## Usage

Use this skill to ${summary.toLowerCase()}.
`

  return {
    slug,
    displayName,
    summary,
    version: '0.1.0',
    metadata: {
      moltbot: {
        nix: {
          plugin: `github:example/${slug}`,
          systems: ['aarch64-darwin', 'x86_64-linux'],
        },
        config: {
          requiredEnv: envVars,
        },
        cliHelp,
      },
    },
    rawSkillMd,
  }
}

// 50 placeholder skills for pagination testing
const EXTRA_SEED_SKILLS: SeedSkillSpec[] = [
  // DevOps & Infrastructure (10)
  makeSkill(
    'kubectl-helper',
    'Kubectl Helper',
    'Simplified kubectl commands for common Kubernetes operations.',
    ['KUBECONFIG'],
    ['pods', 'logs', 'exec', 'describe', 'apply'],
  ),
  makeSkill(
    'terraform-runner',
    'Terraform Runner',
    'Execute Terraform plans and applies with safety checks.',
    ['TF_VAR_region', 'AWS_PROFILE'],
    ['plan', 'apply', 'destroy', 'output', 'state'],
  ),
  makeSkill(
    'ansible-exec',
    'Ansible Exec',
    'Run Ansible playbooks and ad-hoc commands.',
    ['ANSIBLE_INVENTORY'],
    ['playbook', 'adhoc', 'inventory', 'facts', 'vault'],
  ),
  makeSkill(
    'docker-compose-mgr',
    'Docker Compose Manager',
    'Manage Docker Compose stacks and services.',
    ['DOCKER_HOST'],
    ['up', 'down', 'logs', 'ps', 'restart'],
  ),
  makeSkill(
    'k9s-wrapper',
    'K9s Wrapper',
    'Interactive Kubernetes cluster management via K9s.',
    ['KUBECONFIG'],
    ['launch', 'contexts', 'namespaces', 'pods', 'logs'],
  ),
  makeSkill(
    'helm-charts',
    'Helm Charts',
    'Manage Helm chart deployments and releases.',
    ['KUBECONFIG', 'HELM_REPO'],
    ['install', 'upgrade', 'rollback', 'list', 'search'],
  ),
  makeSkill(
    'prometheus-alerts',
    'Prometheus Alerts',
    'Query Prometheus metrics and manage alerting rules.',
    ['PROMETHEUS_URL'],
    ['query', 'alerts', 'rules', 'targets', 'status'],
  ),
  makeSkill(
    'grafana-dash',
    'Grafana Dashboards',
    'Create and manage Grafana dashboards programmatically.',
    ['GRAFANA_URL', 'GRAFANA_API_KEY'],
    ['list', 'export', 'import', 'create', 'delete'],
  ),
  makeSkill(
    'nginx-config',
    'Nginx Config',
    'Generate and validate Nginx configuration files.',
    ['NGINX_CONF_DIR'],
    ['generate', 'validate', 'reload', 'test', 'sites'],
  ),
  makeSkill(
    'jenkins-jobs',
    'Jenkins Jobs',
    'Manage Jenkins jobs and pipelines.',
    ['JENKINS_URL', 'JENKINS_TOKEN'],
    ['list', 'build', 'status', 'logs', 'config'],
  ),

  // Productivity (8)
  makeSkill(
    'todoist-sync',
    'Todoist Sync',
    'Sync and manage Todoist tasks from the command line.',
    ['TODOIST_API_TOKEN'],
    ['list', 'add', 'complete', 'projects', 'labels'],
  ),
  makeSkill(
    'notion-backup',
    'Notion Backup',
    'Export and backup Notion workspaces.',
    ['NOTION_TOKEN'],
    ['export', 'backup', 'restore', 'pages', 'databases'],
  ),
  makeSkill(
    'gcal-manager',
    'Google Calendar Manager',
    'Manage Google Calendar events and schedules.',
    ['GOOGLE_CREDENTIALS_FILE'],
    ['events', 'create', 'delete', 'calendars', 'reminders'],
  ),
  makeSkill(
    'time-tracker',
    'Time Tracker',
    'Track time spent on projects and tasks.',
    ['TIMETRACK_DB'],
    ['start', 'stop', 'status', 'report', 'projects'],
  ),
  makeSkill(
    'email-digest',
    'Email Digest',
    'Generate email digests and summaries.',
    ['IMAP_SERVER', 'IMAP_USER'],
    ['fetch', 'digest', 'search', 'folders', 'unread'],
  ),
  makeSkill(
    'habit-tracker',
    'Habit Tracker',
    'Track daily habits and streaks.',
    ['HABITS_DB'],
    ['log', 'streak', 'stats', 'habits', 'remind'],
  ),
  makeSkill(
    'bookmark-sync',
    'Bookmark Sync',
    'Sync bookmarks across browsers and devices.',
    ['BOOKMARKS_DIR'],
    ['sync', 'export', 'import', 'search', 'tags'],
  ),
  makeSkill(
    'notes-export',
    'Notes Export',
    'Export notes to various formats.',
    ['NOTES_DIR'],
    ['export', 'convert', 'search', 'list', 'tags'],
  ),

  // Media & Entertainment (6)
  makeSkill(
    'spotify-ctl',
    'Spotify Control',
    'Control Spotify playback from the terminal.',
    ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'],
    ['play', 'pause', 'next', 'prev', 'search'],
  ),
  makeSkill(
    'plex-manager',
    'Plex Manager',
    'Manage Plex media libraries and playback.',
    ['PLEX_URL', 'PLEX_TOKEN'],
    ['libraries', 'scan', 'search', 'play', 'sessions'],
  ),
  makeSkill(
    'ytdl-wrapper',
    'YouTube Downloader',
    'Download videos from YouTube and other platforms.',
    ['YTDL_OUTPUT_DIR'],
    ['download', 'info', 'playlist', 'audio', 'formats'],
  ),
  makeSkill(
    'podcast-dl',
    'Podcast Downloader',
    'Download and manage podcast episodes.',
    ['PODCAST_DIR'],
    ['subscribe', 'download', 'list', 'play', 'search'],
  ),
  makeSkill(
    'audiobook-player',
    'Audiobook Player',
    'Manage and play audiobook collections.',
    ['AUDIOBOOK_DIR'],
    ['play', 'pause', 'bookmark', 'list', 'progress'],
  ),
  makeSkill(
    'music-lib',
    'Music Library',
    'Organize and query local music libraries.',
    ['MUSIC_DIR'],
    ['scan', 'search', 'play', 'playlist', 'stats'],
  ),

  // Smart Home (8)
  makeSkill(
    'hass-control',
    'Home Assistant Control',
    'Control Home Assistant entities and automations.',
    ['HASS_URL', 'HASS_TOKEN'],
    ['entities', 'services', 'automations', 'scenes', 'history'],
  ),
  makeSkill(
    'zigbee-mqtt',
    'Zigbee2MQTT',
    'Manage Zigbee devices via MQTT.',
    ['MQTT_BROKER', 'ZIGBEE_TOPIC'],
    ['devices', 'pair', 'remove', 'rename', 'groups'],
  ),
  makeSkill(
    'tasmota-ctl',
    'Tasmota Control',
    'Control Tasmota-flashed devices.',
    ['TASMOTA_HOSTS'],
    ['status', 'power', 'config', 'update', 'backup'],
  ),
  makeSkill(
    'esphome-mgr',
    'ESPHome Manager',
    'Manage ESPHome device configurations.',
    ['ESPHOME_DIR'],
    ['compile', 'upload', 'logs', 'dashboard', 'config'],
  ),
  makeSkill(
    'mqtt-broker',
    'MQTT Broker',
    'Interact with MQTT brokers for IoT messaging.',
    ['MQTT_BROKER', 'MQTT_USER'],
    ['pub', 'sub', 'topics', 'clients', 'stats'],
  ),
  makeSkill(
    'hue-lights',
    'Philips Hue',
    'Control Philips Hue lights and scenes.',
    ['HUE_BRIDGE_IP', 'HUE_API_KEY'],
    ['lights', 'scenes', 'groups', 'schedules', 'sensors'],
  ),
  makeSkill(
    'smart-thermo',
    'Smart Thermostat',
    'Control smart thermostats and HVAC systems.',
    ['THERMOSTAT_API_KEY'],
    ['status', 'set', 'schedule', 'history', 'zones'],
  ),
  makeSkill(
    'cam-viewer',
    'Camera Viewer',
    'View and manage security camera feeds.',
    ['CAMERA_URLS'],
    ['list', 'snapshot', 'stream', 'record', 'events'],
  ),

  // Finance (5)
  makeSkill(
    'budget-track',
    'Budget Tracker',
    'Track budgets and spending across categories.',
    ['BUDGET_DB'],
    ['summary', 'add', 'categories', 'report', 'goals'],
  ),
  makeSkill(
    'crypto-watch',
    'Crypto Watcher',
    'Monitor cryptocurrency prices and portfolios.',
    ['CRYPTO_API_KEY'],
    ['prices', 'portfolio', 'alerts', 'history', 'convert'],
  ),
  makeSkill(
    'stock-alerts',
    'Stock Alerts',
    'Set up stock price alerts and notifications.',
    ['STOCK_API_KEY'],
    ['quote', 'watch', 'alerts', 'portfolio', 'news'],
  ),
  makeSkill(
    'expense-cat',
    'Expense Categorizer',
    'Automatically categorize expenses.',
    ['EXPENSE_DB'],
    ['import', 'categorize', 'report', 'rules', 'export'],
  ),
  makeSkill(
    'invoice-gen',
    'Invoice Generator',
    'Generate and manage invoices.',
    ['INVOICE_DIR', 'COMPANY_INFO'],
    ['create', 'list', 'send', 'paid', 'overdue'],
  ),

  // Communication (5)
  makeSkill(
    'slack-bot',
    'Slack Bot',
    'Interact with Slack channels and messages.',
    ['SLACK_TOKEN'],
    ['send', 'channels', 'users', 'search', 'files'],
  ),
  makeSkill(
    'discord-mgr',
    'Discord Manager',
    'Manage Discord servers and messages.',
    ['DISCORD_TOKEN'],
    ['send', 'servers', 'channels', 'members', 'roles'],
  ),
  makeSkill(
    'telegram-bot',
    'Telegram Bot',
    'Send and receive Telegram messages.',
    ['TELEGRAM_BOT_TOKEN'],
    ['send', 'receive', 'chats', 'files', 'inline'],
  ),
  makeSkill(
    'matrix-cli',
    'Matrix CLI',
    'Interact with Matrix chat rooms.',
    ['MATRIX_HOMESERVER', 'MATRIX_TOKEN'],
    ['send', 'rooms', 'join', 'leave', 'sync'],
  ),
  makeSkill(
    'irc-bridge',
    'IRC Bridge',
    'Bridge IRC channels to other platforms.',
    ['IRC_SERVER', 'IRC_NICK'],
    ['connect', 'join', 'send', 'channels', 'users'],
  ),

  // Data & Analytics (5)
  makeSkill(
    'pg-queries',
    'PostgreSQL Queries',
    'Execute PostgreSQL queries and manage databases.',
    ['DATABASE_URL'],
    ['query', 'tables', 'schema', 'backup', 'restore'],
  ),
  makeSkill(
    'clickhouse-ql',
    'ClickHouse Queries',
    'Run ClickHouse analytics queries.',
    ['CLICKHOUSE_URL'],
    ['query', 'tables', 'insert', 'system', 'optimize'],
  ),
  makeSkill(
    'redis-cli',
    'Redis CLI',
    'Interact with Redis cache and data structures.',
    ['REDIS_URL'],
    ['get', 'set', 'keys', 'info', 'flush'],
  ),
  makeSkill(
    'elastic-search',
    'Elasticsearch',
    'Search and manage Elasticsearch indices.',
    ['ELASTICSEARCH_URL'],
    ['search', 'index', 'mapping', 'cluster', 'aliases'],
  ),
  makeSkill(
    'mongo-shell',
    'MongoDB Shell',
    'Query and manage MongoDB collections.',
    ['MONGODB_URI'],
    ['find', 'insert', 'update', 'delete', 'aggregate'],
  ),

  // Security (3)
  makeSkill(
    'vault-secrets',
    'Vault Secrets',
    'Manage secrets in HashiCorp Vault.',
    ['VAULT_ADDR', 'VAULT_TOKEN'],
    ['read', 'write', 'list', 'delete', 'seal'],
  ),
  makeSkill(
    'gpg-keys',
    'GPG Keys',
    'Manage GPG keys and encryption.',
    ['GNUPGHOME'],
    ['list', 'generate', 'export', 'import', 'encrypt'],
  ),
  makeSkill(
    'ssh-rotate',
    'SSH Key Rotator',
    'Rotate and manage SSH keys.',
    ['SSH_KEY_DIR'],
    ['generate', 'rotate', 'deploy', 'list', 'revoke'],
  ),
]

function injectMetadata(rawSkillMd: string, metadata: Record<string, unknown>) {
  const frontmatterEnd = rawSkillMd.indexOf('\n---', 3)
  if (frontmatterEnd === -1) return rawSkillMd
  return `${rawSkillMd.slice(0, frontmatterEnd)}\nmetadata: ${JSON.stringify(
    metadata,
  )}${rawSkillMd.slice(frontmatterEnd)}`
}

function randomStats() {
  return {
    downloads: Math.floor(Math.random() * 5000),
    stars: Math.floor(Math.random() * 500),
    installsCurrent: Math.floor(Math.random() * 200),
    installsAllTime: Math.floor(Math.random() * 1000),
  }
}

export const applyRandomStats = internalMutation({
  args: {
    skillId: v.id('skills'),
    stats: v.object({
      downloads: v.number(),
      stars: v.number(),
      installsCurrent: v.number(),
      installsAllTime: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId)
    if (!skill) return
    const nextStats = {
      downloads: args.stats.downloads,
      stars: args.stats.stars,
      installsCurrent: args.stats.installsCurrent,
      installsAllTime: args.stats.installsAllTime,
      versions: 1,
      comments: 0,
    }
    await ctx.db.patch(args.skillId, {
      statsDownloads: args.stats.downloads,
      statsStars: args.stats.stars,
      statsInstallsCurrent: args.stats.installsCurrent,
      statsInstallsAllTime: args.stats.installsAllTime,
      stats: nextStats,
    })
    await upsertResourceForSkill(ctx, skill, {
      statsDownloads: args.stats.downloads,
      statsStars: args.stats.stars,
      statsInstallsCurrent: args.stats.installsCurrent,
      statsInstallsAllTime: args.stats.installsAllTime,
      stats: nextStats,
    })
  },
})

export const seedExtraSkillsInternal = internalAction({
  args: {
    reset: v.optional(v.boolean()),
  },
  handler: async (ctx: ActionCtx, args) => {
    const results: Array<{ slug: string; ok: boolean; skipped?: boolean }> = []

    for (const spec of EXTRA_SEED_SKILLS) {
      const skillMd = injectMetadata(spec.rawSkillMd, spec.metadata)
      const frontmatter = parseFrontmatter(skillMd)
      const moltbot = parseMoltbotMetadata(frontmatter)
      const storageId = await ctx.storage.store(new Blob([skillMd], { type: 'text/markdown' }))

      const result = (await ctx.runMutation(internal.devSeed.seedSkillMutation, {
        reset: args.reset,
        storageId,
        metadata: spec.metadata,
        frontmatter,
        moltbot,
        skillMd,
        slug: spec.slug,
        displayName: spec.displayName,
        summary: spec.summary,
        version: spec.version,
      })) as { ok: boolean; skipped?: boolean; skillId?: string }

      // Apply random stats after creation (only if not skipped)
      if (result.skillId && !result.skipped) {
        const stats = randomStats()
        await ctx.runMutation(internal.devSeedExtra.applyRandomStats, {
          skillId: result.skillId as Id<'skills'>,
          stats,
        })
      }

      results.push({ slug: spec.slug, ok: result.ok, skipped: result.skipped })
    }

    const created = results.filter((r) => !r.skipped).length
    const skipped = results.filter((r) => r.skipped).length

    return { ok: true, total: results.length, created, skipped }
  },
})
