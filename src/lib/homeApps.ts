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
    id: "matrix",
    runtimeId: "matrix",
    name: "Matrix",
    description: "Rooms and direct messages on Matrix.",
    packageName: "@openclaw/matrix",
    iconDomain: "matrix.org",
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
    packageName: "@openclaw/brave",
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
];

export function homeAppIconUrl(iconDomain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(iconDomain)}&sz=128`;
}

export function homePluginShortcutIconUrl(shortcut: HomePluginShortcut) {
  return homeAppIconUrl(shortcut.iconDomain);
}

export const SKILLS_BROWSE_SEARCH = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  view: undefined,
  focus: undefined,
} as const;
