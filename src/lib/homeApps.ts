/** Curated shortcuts for the homepage app categories. */

type HomeAppId = keyof typeof HOME_APP_SIMPLE_ICONS | keyof typeof HOME_APP_IMAGE_ICONS;

export type HomeSkillApp = {
  id: HomeAppId;
  name: string;
  description: string;
  /** Skills browse search query. */
  browseQuery: string;
};

export type HomePluginShortcut = {
  id: HomeAppId;
  name: string;
  description: string;
  packageName: string;
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
  "nextcloud-talk": "nextcloud",
  notion: "notion",
  obsidian: "obsidian",
  perplexity: "perplexity",
  "diagnostics-prometheus": "prometheus",
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

/** Skills for everyday tools. */
export const HOME_SKILL_APPS: HomeSkillApp[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    description: "Browse, scrape, and automate the web from your agent.",
    browseQuery: "chrome browser",
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Edit repos, run tasks, and ship code from the editor.",
    browseQuery: "vscode",
  },
  {
    id: "github",
    name: "GitHub",
    description: "Review PRs, manage issues, and automate repo workflows.",
    browseQuery: "github",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read pages, update databases, and draft docs in Notion.",
    browseQuery: "notion",
  },
  {
    id: "linear",
    name: "Linear",
    description: "Create issues, sync cycles, and keep product work moving.",
    browseQuery: "linear",
  },
  {
    id: "figma",
    name: "Figma",
    description: "Export assets, comment on files, and sync design context.",
    browseQuery: "figma",
  },
  {
    id: "aws",
    name: "AWS",
    description: "Operate cloud resources and deploy from agent playbooks.",
    browseQuery: "aws",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Send messages, search conversations, and manage channels.",
    browseQuery: "slack",
  },
  {
    id: "discord",
    name: "Discord",
    description: "Work with messages, channels, reactions, and communities.",
    browseQuery: "discord",
  },
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Manage Markdown vaults, notes, and knowledge workflows.",
    browseQuery: "obsidian",
  },
  {
    id: "trello",
    name: "Trello",
    description: "Manage boards, lists, cards, and project workflows.",
    browseQuery: "trello",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, send, search, and organize email.",
    browseQuery: "gmail",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Find, create, and manage files and folders.",
    browseQuery: "google drive",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read, write, and automate spreadsheet data.",
    browseQuery: "google sheets",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Create events, check availability, and manage calendars.",
    browseQuery: "google calendar",
  },
  {
    id: "jira",
    name: "Jira",
    description: "Search, create, update, and transition issues.",
    browseQuery: "jira",
  },
  {
    id: "airtable",
    name: "Airtable",
    description: "Manage bases, tables, records, and fields.",
    browseQuery: "airtable",
  },
  {
    id: "dropbox",
    name: "Dropbox",
    description: "Browse, search, upload, and manage files.",
    browseQuery: "dropbox",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Operate containers, images, and Compose stacks.",
    browseQuery: "docker",
  },
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Deploy, inspect, and troubleshoot clusters.",
    browseQuery: "kubernetes",
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Manage projects, merge requests, issues, and pipelines.",
    browseQuery: "gitlab",
  },
];

/** Gateway plugin shortcuts. */
export const HOME_PLUGIN_SHORTCUTS: HomePluginShortcut[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    description: "WhatsApp Web channel plugin for agent chats.",
    packageName: "@openclaw/whatsapp",
  },
  {
    id: "qqbot",
    name: "QQ Bot",
    description: "Group and direct-message workflows for QQ.",
    packageName: "@openclaw/qqbot",
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Rooms and direct messages on Matrix.",
    packageName: "@openclaw/matrix",
  },
  {
    id: "nextcloud-talk",
    name: "Nextcloud Talk",
    description: "Self-hosted team conversations and calls.",
    packageName: "@openclaw/nextcloud-talk",
  },
  {
    id: "voice-call",
    name: "Voice Call",
    description: "Phone-call workflows through Twilio, Telnyx, and Plivo.",
    packageName: "@openclaw/voice-call",
  },
  {
    id: "line",
    name: "LINE",
    description: "LINE Bot API chats from OpenClaw.",
    packageName: "@openclaw/line",
  },
  {
    id: "twitch",
    name: "Twitch",
    description: "Chat and moderation workflows for streams.",
    packageName: "@openclaw/twitch",
  },
  {
    id: "feishu",
    name: "Feishu/Lark",
    description: "Workplace chats and collaboration tools.",
    packageName: "@openclaw/feishu",
  },
  {
    id: "msteams",
    name: "Microsoft Teams",
    description: "Meetings and team chat for agents.",
    packageName: "@openclaw/msteams",
  },
  {
    id: "brave",
    name: "Brave Search",
    description: "Brave Search provider for web lookup.",
    packageName: "@openclaw/brave-plugin",
  },
  {
    id: "googlechat",
    name: "Google Chat",
    description: "Spaces and direct messages on Google Chat.",
    packageName: "@openclaw/googlechat",
  },
  {
    id: "google-meet",
    name: "Google Meet",
    description: "Join calls through Chrome or phone transports.",
    packageName: "@openclaw/google-meet",
  },
  {
    id: "parallel",
    name: "Parallel",
    description: "Parallel web search for research workflows.",
    packageName: "@openclaw/parallel-plugin",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    description: "Perplexity-powered web answers.",
    packageName: "@openclaw/perplexity-plugin",
  },
  {
    id: "exa",
    name: "Exa",
    description: "Neural web search for agent research.",
    packageName: "@openclaw/exa-plugin",
  },
  {
    id: "firecrawl",
    name: "Firecrawl",
    description: "Crawl and extract web pages for agents.",
    packageName: "@openclaw/firecrawl-plugin",
  },
  {
    id: "scraperapi",
    name: "ScraperAPI",
    description: "ScraperAPI skills for large-scale extraction.",
    packageName: "@scraperapitech/scraperapi-skills",
  },
  {
    id: "diagnostics-prometheus",
    name: "Prometheus",
    description: "Runtime metrics for observability dashboards.",
    packageName: "@openclaw/diagnostics-prometheus",
  },
  {
    id: "amazon-bedrock",
    name: "Amazon Bedrock",
    description: "Bedrock models, embeddings, and guardrails.",
    packageName: "@openclaw/amazon-bedrock-provider",
  },
  {
    id: "cloudflare-gateway",
    name: "Cloudflare AI Gateway",
    description: "Model routing through Cloudflare AI Gateway.",
    packageName: "@openclaw/cloudflare-ai-gateway-provider",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Groq media-understanding provider.",
    packageName: "@openclaw/groq-provider",
  },
  {
    id: "deepinfra",
    name: "DeepInfra",
    description: "DeepInfra model provider for OpenClaw.",
    packageName: "@openclaw/deepinfra-provider",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    description: "Cerebras model provider for OpenClaw.",
    packageName: "@openclaw/cerebras-provider",
  },
  {
    id: "qwen",
    name: "Qwen Cloud",
    description: "Qwen Cloud provider for OpenClaw.",
    packageName: "@openclaw/qwen-provider",
  },
  {
    id: "llama-cpp",
    name: "llama.cpp",
    description: "Local embedding provider through llama.cpp.",
    packageName: "@openclaw/llama-cpp-provider",
  },
  {
    id: "apple-pim",
    name: "Apple PIM",
    description: "Calendar, Reminders, Contacts, and Mail on macOS.",
    packageName: "apple-pim-cli",
  },
];

export function simpleIconUrl(slug: string) {
  return `${SIMPLE_ICON_BASE_URL}/${slug}.svg`;
}

export function homeAppIcon(id: HomeAppId): HomeAppIcon {
  if (id in HOME_APP_IMAGE_ICONS) {
    return {
      kind: "image",
      src: HOME_APP_IMAGE_ICONS[id as keyof typeof HOME_APP_IMAGE_ICONS],
    };
  }

  return {
    kind: "simple",
    slug: HOME_APP_SIMPLE_ICONS[id as keyof typeof HOME_APP_SIMPLE_ICONS],
  };
}

export const SKILLS_BROWSE_SEARCH = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  view: undefined,
  focus: undefined,
} as const;
