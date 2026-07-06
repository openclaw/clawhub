/** Curated shortcuts for the home apps constellation (design-time). */

export type HomeSkillApp = {
  id: string;
  name: string;
  description: string;
  /** Skills browse search query. */
  browseQuery: string;
  /** Brand favicon via Google favicon helper (domain only). */
  iconDomain: string;
};

export type HomePluginShortcut = {
  id: string;
  runtimeId: string;
  name: string;
  description: string;
  packageName: string;
  /** Brand favicon via Google favicon helper (domain only). */
  iconDomain: string;
};

export type HomeAppIcon =
  | {
      kind: "simple";
      /** Simple Icons slug from https://simpleicons.org/. */
      slug: string;
    }
  | {
      kind: "image";
      /** Local SVG fallback for brands that are not available in Simple Icons. */
      src: string;
    };

const SIMPLE_ICON_BASE_URL = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons";
const LOCAL_APP_ICON_BASE = "/app-icons";

const HOME_APP_SIMPLE_ICONS = {
  "amazon-bedrock": "amazonwebservices",
  "apple-pim": "apple",
  airtable: "airtable",
  aws: "amazonwebservices",
  brave: "brave",
  chrome: "googlechrome",
  "cloudflare-gateway": "cloudflare",
  discord: "discord",
  docker: "docker",
  dropbox: "dropbox",
  figma: "figma",
  github: "github",
  gitlab: "gitlab",
  gmail: "gmail",
  googlechat: "googlechat",
  "google-calendar": "googlecalendar",
  "google-drive": "googledrive",
  "google-meet": "googlemeet",
  "google-sheets": "googlesheets",
  jira: "jira",
  kubernetes: "kubernetes",
  line: "line",
  linear: "linear",
  matrix: "matrix",
  msteams: "microsoftteams",
  nextcloud: "nextcloud",
  "nextcloud-talk": "nextcloud",
  notion: "notion",
  obsidian: "obsidian",
  perplexity: "perplexity",
  "diagnostics-prometheus": "prometheus",
  prometheus: "prometheus",
  qqbot: "qq",
  qwen: "qwen",
  slack: "slack",
  trello: "trello",
  twitch: "twitch",
  "voice-call": "twilio",
  vscode: "visualstudiocode",
  whatsapp: "whatsapp",
} as const;

const HOME_APP_IMAGE_ICONS = {
  cerebras: `${LOCAL_APP_ICON_BASE}/cerebras.svg`,
  deepinfra: `${LOCAL_APP_ICON_BASE}/deepinfra.svg`,
  exa: `${LOCAL_APP_ICON_BASE}/exa.svg`,
  feishu: `${LOCAL_APP_ICON_BASE}/feishu.svg`,
  firecrawl: `${LOCAL_APP_ICON_BASE}/firecrawl.svg`,
  groq: `${LOCAL_APP_ICON_BASE}/groq.svg`,
  "llama-cpp": `${LOCAL_APP_ICON_BASE}/llama-cpp.svg`,
  parallel: `${LOCAL_APP_ICON_BASE}/parallel.svg`,
  scraperapi: `${LOCAL_APP_ICON_BASE}/scraperapi.svg`,
} as const;

/** Left orbit — skills for everyday tools. */
export const HOME_SKILL_APPS: HomeSkillApp[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    description: "Browse, scrape, and automate the web from your agent.",
    browseQuery: "chrome browser",
    iconDomain: "google.com",
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Edit repos, run tasks, and ship code from the editor.",
    browseQuery: "vscode",
    iconDomain: "code.visualstudio.com",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Review PRs, manage issues, and automate repo workflows.",
    browseQuery: "github",
    iconDomain: "github.com",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read pages, update databases, and draft docs in Notion.",
    browseQuery: "notion",
    iconDomain: "notion.so",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Create issues, sync cycles, and keep product work moving.",
    browseQuery: "linear",
    iconDomain: "linear.app",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Export assets, comment on files, and sync design context.",
    browseQuery: "figma",
    iconDomain: "figma.com",
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "Pair with your editor and run agent workflows in Cursor.",
    browseQuery: "cursor",
    iconDomain: "cursor.com",
  },
  {
    id: "raycast",
    name: "Raycast",
    description: "Launch commands, scripts, and quick actions on macOS.",
    browseQuery: "raycast",
    iconDomain: "raycast.com",
  },
  {
    id: "aws",
    name: "AWS",
    description: "Operate cloud resources and deploy from agent playbooks.",
    browseQuery: "aws",
    iconDomain: "aws.amazon.com",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, search conversations, and manage channels.",
    browseQuery: "slack",
    iconDomain: "slack.com",
  },
  {
    id: "discord",
    name: "Discord",
    description: "Work with messages, channels, reactions, and communities.",
    browseQuery: "discord",
    iconDomain: "discord.com",
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Manage Markdown vaults, notes, and knowledge workflows.",
    browseQuery: "obsidian",
    iconDomain: "obsidian.md",
  },
  {
    id: "trello",
    name: "Trello",
    description: "Manage boards, lists, cards, and project workflows.",
    browseQuery: "trello",
    iconDomain: "trello.com",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, send, search, and organize email.",
    browseQuery: "gmail",
    iconDomain: "mail.google.com",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Find, create, and manage files and folders.",
    browseQuery: "google drive",
    iconDomain: "drive.google.com",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read, write, and automate spreadsheet data.",
    browseQuery: "google sheets",
    iconDomain: "sheets.google.com",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Create events, check availability, and manage calendars.",
    browseQuery: "google calendar",
    iconDomain: "calendar.google.com",
  },
  {
    id: "jira",
    name: "Jira",
    description: "Search, create, update, and transition issues.",
    browseQuery: "jira",
    iconDomain: "atlassian.com",
  },
  {
    id: "telegram",
    name: "Telegram",
    description: "Build bot workflows and automate conversations.",
    browseQuery: "telegram",
    iconDomain: "telegram.org",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Manage bases, tables, records, and fields.",
    browseQuery: "airtable",
    iconDomain: "airtable.com",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Browse, search, upload, and manage files.",
    browseQuery: "dropbox",
    iconDomain: "dropbox.com",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Operate containers, images, and Compose stacks.",
    browseQuery: "docker",
    iconDomain: "docker.com",
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Deploy, inspect, and troubleshoot clusters.",
    browseQuery: "kubernetes",
    iconDomain: "kubernetes.io",
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Manage projects, merge requests, issues, and pipelines.",
    browseQuery: "gitlab",
    iconDomain: "gitlab.com",
  },
  {
    id: "salesforce",
    name: "Salesforce",
    description: "Query CRM data and manage sales workflows.",
    browseQuery: "salesforce",
    iconDomain: "salesforce.com",
  },
  {
    id: "hubspot",
    name: "HubSpot",
    description: "Work with contacts, companies, deals, and pipelines.",
    browseQuery: "hubspot",
    iconDomain: "hubspot.com",
  },
];

/** Right orbit — official @openclaw gateway plugins. */
export const HOME_PLUGIN_SHORTCUTS: HomePluginShortcut[] = [
  {
    id: "whatsapp",
    runtimeId: "whatsapp",
    name: "WhatsApp",
    description: "WhatsApp Web channel plugin for agent chats.",
    packageName: "@openclaw/whatsapp",
    iconDomain: "whatsapp.com",
  },
  {
    id: "qqbot",
    runtimeId: "qqbot",
    name: "QQ Bot",
    description: "Group and direct-message workflows for QQ.",
    packageName: "@openclaw/qqbot",
    iconDomain: "qq.com",
  },
  {
    id: "matrix",
    runtimeId: "matrix",
    name: "Matrix",
    description: "Rooms and direct messages on Matrix.",
    packageName: "@openclaw/matrix",
    iconDomain: "matrix.org",
  },
  {
    id: "nextcloud-talk",
    runtimeId: "nextcloud-talk",
    name: "Nextcloud Talk",
    description: "Self-hosted team conversations and calls.",
    packageName: "@openclaw/nextcloud-talk",
    iconDomain: "nextcloud.com",
  },
  {
    id: "voice-call",
    runtimeId: "voice-call",
    name: "Voice Call",
    description: "Phone-call workflows through Twilio, Telnyx, and Plivo.",
    packageName: "@openclaw/voice-call",
    iconDomain: "twilio.com",
  },
  {
    id: "line",
    runtimeId: "line",
    name: "LINE",
    description: "LINE Bot API chats from OpenClaw.",
    packageName: "@openclaw/line",
    iconDomain: "line.me",
  },
  {
    id: "twitch",
    runtimeId: "twitch",
    name: "Twitch",
    description: "Chat and moderation workflows for streams.",
    packageName: "@openclaw/twitch",
    iconDomain: "twitch.tv",
  },
  {
    id: "codex",
    runtimeId: "codex",
    name: "Codex",
    description: "Codex app-server harness and model provider.",
    packageName: "@openclaw/codex",
    iconDomain: "openai.com",
  },
  {
    id: "discord",
    runtimeId: "discord",
    name: "Discord",
    description: "Channels, DMs, commands, and app events.",
    packageName: "@openclaw/discord",
    iconDomain: "discord.com",
  },
  {
    id: "feishu",
    runtimeId: "feishu",
    name: "Feishu/Lark",
    description: "Workplace chats and collaboration tools.",
    packageName: "@openclaw/feishu",
    iconDomain: "feishu.cn",
  },
  {
    id: "slack",
    runtimeId: "slack",
    name: "Slack",
    description: "Channels, DMs, commands, and app events.",
    packageName: "@openclaw/slack",
    iconDomain: "slack.com",
  },
  {
    id: "msteams",
    runtimeId: "msteams",
    name: "Microsoft Teams",
    description: "Meetings and team chat for agents.",
    packageName: "@openclaw/msteams",
    iconDomain: "teams.microsoft.com",
  },
  {
    id: "brave",
    runtimeId: "brave",
    name: "Brave Search",
    description: "Brave Search provider for web lookup.",
    packageName: "@openclaw/brave-plugin",
    iconDomain: "brave.com",
  },
  {
    id: "googlechat",
    runtimeId: "googlechat",
    name: "Google Chat",
    description: "Spaces and direct messages on Google Chat.",
    packageName: "@openclaw/googlechat",
    iconDomain: "chat.google.com",
  },
  {
    id: "google-meet",
    runtimeId: "google-meet",
    name: "Google Meet",
    description: "Join calls through Chrome or phone transports.",
    packageName: "@openclaw/google-meet",
    iconDomain: "meet.google.com",
  },
  {
    id: "parallel",
    runtimeId: "parallel-plugin",
    name: "Parallel",
    description: "Parallel web search for research workflows.",
    packageName: "@openclaw/parallel-plugin",
    iconDomain: "parallel.ai",
  },
  {
    id: "perplexity",
    runtimeId: "perplexity-plugin",
    name: "Perplexity",
    description: "Perplexity-powered web answers.",
    packageName: "@openclaw/perplexity-plugin",
    iconDomain: "perplexity.ai",
  },
  {
    id: "exa",
    runtimeId: "exa-plugin",
    name: "Exa",
    description: "Neural web search for agent research.",
    packageName: "@openclaw/exa-plugin",
    iconDomain: "exa.ai",
  },
  {
    id: "firecrawl",
    runtimeId: "firecrawl-plugin",
    name: "Firecrawl",
    description: "Crawl and extract web pages for agents.",
    packageName: "@openclaw/firecrawl-plugin",
    iconDomain: "firecrawl.dev",
  },
  {
    id: "scraperapi",
    runtimeId: "scraperapi-skills",
    name: "ScraperAPI",
    description: "ScraperAPI skills for large-scale extraction.",
    packageName: "@scraperapitech/scraperapi-skills",
    iconDomain: "scraperapi.com",
  },
  {
    id: "diagnostics-prometheus",
    runtimeId: "diagnostics-prometheus",
    name: "Prometheus",
    description: "Runtime metrics for observability dashboards.",
    packageName: "@openclaw/diagnostics-prometheus",
    iconDomain: "prometheus.io",
  },
  {
    id: "amazon-bedrock",
    runtimeId: "amazon-bedrock-provider",
    name: "Amazon Bedrock",
    description: "Bedrock models, embeddings, and guardrails.",
    packageName: "@openclaw/amazon-bedrock-provider",
    iconDomain: "aws.amazon.com",
  },
  {
    id: "cloudflare-gateway",
    runtimeId: "cloudflare-ai-gateway-provider",
    name: "Cloudflare AI Gateway",
    description: "Model routing through Cloudflare AI Gateway.",
    packageName: "@openclaw/cloudflare-ai-gateway-provider",
    iconDomain: "cloudflare.com",
  },
  {
    id: "groq",
    runtimeId: "groq-provider",
    name: "Groq",
    description: "Groq media-understanding provider.",
    packageName: "@openclaw/groq-provider",
    iconDomain: "groq.com",
  },
  {
    id: "deepinfra",
    runtimeId: "deepinfra-provider",
    name: "DeepInfra",
    description: "DeepInfra model provider for OpenClaw.",
    packageName: "@openclaw/deepinfra-provider",
    iconDomain: "deepinfra.com",
  },
  {
    id: "cerebras",
    runtimeId: "cerebras-provider",
    name: "Cerebras",
    description: "Cerebras model provider for OpenClaw.",
    packageName: "@openclaw/cerebras-provider",
    iconDomain: "cerebras.ai",
  },
  {
    id: "qwen",
    runtimeId: "qwen-provider",
    name: "Qwen Cloud",
    description: "Qwen Cloud provider for OpenClaw.",
    packageName: "@openclaw/qwen-provider",
    iconDomain: "qwen.ai",
  },
  {
    id: "llama-cpp",
    runtimeId: "llama-cpp-provider",
    name: "llama.cpp",
    description: "Local embedding provider through llama.cpp.",
    packageName: "@openclaw/llama-cpp-provider",
    iconDomain: "github.com",
  },
  {
    id: "apple-pim",
    runtimeId: "apple-pim",
    name: "Apple PIM",
    description: "Calendar, Reminders, Contacts, and Mail on macOS.",
    packageName: "apple-pim-cli",
    iconDomain: "apple.com",
  },
  {
    id: "gmail-plugin",
    runtimeId: "gmail",
    name: "Gmail",
    description: "Search mailboxes, threads, and attachments.",
    packageName: "@manuelfedele/openclaw-gmail-plugin",
    iconDomain: "mail.google.com",
  },
];

function homeAppIconUrl(iconDomain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(iconDomain)}&sz=128`;
}

export function simpleIconUrl(slug: string) {
  return `${SIMPLE_ICON_BASE_URL}/${slug}.svg`;
}

const HOME_APP_POPULAR_SIMPLE_ICON_IDS = [
  "github",
  "vscode",
  "notion",
  "slack",
  "gmail",
  "google-drive",
  "google-sheets",
  "google-calendar",
  "linear",
  "figma",
  "trello",
  "whatsapp",
] as const satisfies readonly (keyof typeof HOME_APP_SIMPLE_ICONS)[];

export const HOME_APP_ICON_PRELOAD_HREFS = [
  ...HOME_APP_POPULAR_SIMPLE_ICON_IDS.map((id) => simpleIconUrl(HOME_APP_SIMPLE_ICONS[id])),
  ...Object.values(HOME_APP_IMAGE_ICONS),
];

function homeAppIcon({ id, iconDomain }: { id: string; iconDomain?: string }): HomeAppIcon {
  if (id in HOME_APP_IMAGE_ICONS) {
    return {
      kind: "image",
      src: HOME_APP_IMAGE_ICONS[id as keyof typeof HOME_APP_IMAGE_ICONS],
    };
  }

  if (id in HOME_APP_SIMPLE_ICONS) {
    return {
      kind: "simple",
      slug: HOME_APP_SIMPLE_ICONS[id as keyof typeof HOME_APP_SIMPLE_ICONS],
    };
  }

  return {
    kind: "image",
    src: homeAppIconUrl(iconDomain ?? id),
  };
}

export function homeSkillAppIcon(app: HomeSkillApp) {
  return homeAppIcon(app);
}

export function homePluginShortcutIcon(shortcut: HomePluginShortcut) {
  return homeAppIcon(shortcut);
}

export const SKILLS_BROWSE_SEARCH = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  view: undefined,
  focus: undefined,
} as const;
