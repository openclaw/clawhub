/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { destinations } = vi.hoisted(() => ({
  destinations: new Map<string, { to: string; search?: Record<string, unknown> }>(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    search?: Record<string, unknown>;
    title?: string;
    className?: string;
  }) => {
    destinations.set(props.title ?? "footer", { to, search });
    return (
      <a {...props} href={to}>
        {children}
      </a>
    );
  },
}));

import { HomeAppsSection } from "../components/HomeAppsSection";

// Fixed public tile contract, independent of the production shortcut arrays.
// Tuple: name, description, skills query or plugin destination, actual icon URL.
const tiles: Record<string, readonly [string, string, string, string]> = {
  chrome: [
    "Google Chrome",
    "Browse, scrape, and automate the web from your agent.",
    "chrome browser",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/googlechrome.svg",
  ],
  vscode: [
    "VS Code",
    "Edit repos, run tasks, and ship code from the editor.",
    "vscode",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/visualstudiocode.svg",
  ],
  github: [
    "GitHub",
    "Review PRs, manage issues, and automate repo workflows.",
    "github",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/github.svg",
  ],
  notion: [
    "Notion",
    "Read pages, update databases, and draft docs in Notion.",
    "notion",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/notion.svg",
  ],
  linear: [
    "Linear",
    "Create issues, sync cycles, and keep product work moving.",
    "linear",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/linear.svg",
  ],
  figma: [
    "Figma",
    "Export assets, comment on files, and sync design context.",
    "figma",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/figma.svg",
  ],
  aws: [
    "AWS",
    "Operate cloud resources and deploy from agent playbooks.",
    "aws",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/amazonwebservices.svg",
  ],
  slack: [
    "Slack",
    "Send messages, search conversations, and manage channels.",
    "slack",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/slack.svg",
  ],
  discord: [
    "Discord",
    "Work with messages, channels, reactions, and communities.",
    "discord",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/discord.svg",
  ],
  obsidian: [
    "Obsidian",
    "Manage Markdown vaults, notes, and knowledge workflows.",
    "obsidian",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/obsidian.svg",
  ],
  trello: [
    "Trello",
    "Manage boards, lists, cards, and project workflows.",
    "trello",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/trello.svg",
  ],
  gmail: [
    "Gmail",
    "Read, send, search, and organize email.",
    "gmail",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/gmail.svg",
  ],
  "google-drive": [
    "Google Drive",
    "Find, create, and manage files and folders.",
    "google drive",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/googledrive.svg",
  ],
  "google-sheets": [
    "Google Sheets",
    "Read, write, and automate spreadsheet data.",
    "google sheets",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/googlesheets.svg",
  ],
  "google-calendar": [
    "Google Calendar",
    "Create events, check availability, and manage calendars.",
    "google calendar",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/googlecalendar.svg",
  ],
  jira: [
    "Jira",
    "Search, create, update, and transition issues.",
    "jira",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/jira.svg",
  ],
  airtable: [
    "Airtable",
    "Manage bases, tables, records, and fields.",
    "airtable",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/airtable.svg",
  ],
  dropbox: [
    "Dropbox",
    "Browse, search, upload, and manage files.",
    "dropbox",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/dropbox.svg",
  ],
  docker: [
    "Docker",
    "Operate containers, images, and Compose stacks.",
    "docker",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/docker.svg",
  ],
  kubernetes: [
    "Kubernetes",
    "Deploy, inspect, and troubleshoot clusters.",
    "kubernetes",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/kubernetes.svg",
  ],
  gitlab: [
    "GitLab",
    "Manage projects, merge requests, issues, and pipelines.",
    "gitlab",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/gitlab.svg",
  ],
  whatsapp: [
    "WhatsApp",
    "WhatsApp Web channel plugin for agent chats.",
    "/openclaw/plugins/whatsapp",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/whatsapp.svg",
  ],
  qqbot: [
    "QQ Bot",
    "Group and direct-message workflows for QQ.",
    "/openclaw/plugins/qqbot",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/qq.svg",
  ],
  matrix: [
    "Matrix",
    "Rooms and direct messages on Matrix.",
    "/openclaw/plugins/matrix",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/matrix.svg",
  ],
  "nextcloud-talk": [
    "Nextcloud Talk",
    "Self-hosted team conversations and calls.",
    "/openclaw/plugins/nextcloud-talk",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/nextcloud.svg",
  ],
  "voice-call": [
    "Voice Call",
    "Phone-call workflows through Twilio, Telnyx, and Plivo.",
    "/openclaw/plugins/voice-call",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/twilio.svg",
  ],
  line: [
    "LINE",
    "LINE Bot API chats from OpenClaw.",
    "/openclaw/plugins/line",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/line.svg",
  ],
  twitch: [
    "Twitch",
    "Chat and moderation workflows for streams.",
    "/openclaw/plugins/twitch",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/twitch.svg",
  ],
  feishu: [
    "Feishu/Lark",
    "Workplace chats and collaboration tools.",
    "/openclaw/plugins/feishu",
    "/app-icons/feishu.svg",
  ],
  msteams: [
    "Microsoft Teams",
    "Meetings and team chat for agents.",
    "/openclaw/plugins/msteams",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/microsoftteams.svg",
  ],
  brave: [
    "Brave Search",
    "Brave Search provider for web lookup.",
    "/openclaw/plugins/brave-plugin",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/brave.svg",
  ],
  googlechat: [
    "Google Chat",
    "Spaces and direct messages on Google Chat.",
    "/openclaw/plugins/googlechat",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/googlechat.svg",
  ],
  "google-meet": [
    "Google Meet",
    "Join calls through Chrome or phone transports.",
    "/openclaw/plugins/google-meet",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/googlemeet.svg",
  ],
  parallel: [
    "Parallel",
    "Parallel web search for research workflows.",
    "/openclaw/plugins/parallel-plugin",
    "/app-icons/parallel.svg",
  ],
  perplexity: [
    "Perplexity",
    "Perplexity-powered web answers.",
    "/openclaw/plugins/perplexity-plugin",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/perplexity.svg",
  ],
  exa: [
    "Exa",
    "Neural web search for agent research.",
    "/openclaw/plugins/exa-plugin",
    "/app-icons/exa.svg",
  ],
  firecrawl: [
    "Firecrawl",
    "Crawl and extract web pages for agents.",
    "/openclaw/plugins/firecrawl-plugin",
    "/app-icons/firecrawl.svg",
  ],
  scraperapi: [
    "ScraperAPI",
    "ScraperAPI skills for large-scale extraction.",
    "/scraperapitech/plugins/scraperapi-skills",
    "/app-icons/scraperapi.svg",
  ],
  "diagnostics-prometheus": [
    "Prometheus",
    "Runtime metrics for observability dashboards.",
    "/openclaw/plugins/diagnostics-prometheus",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/prometheus.svg",
  ],
  "amazon-bedrock": [
    "Amazon Bedrock",
    "Bedrock models, embeddings, and guardrails.",
    "/openclaw/plugins/amazon-bedrock-provider",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/amazonwebservices.svg",
  ],
  "cloudflare-gateway": [
    "Cloudflare AI Gateway",
    "Model routing through Cloudflare AI Gateway.",
    "/openclaw/plugins/cloudflare-ai-gateway-provider",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/cloudflare.svg",
  ],
  groq: [
    "Groq",
    "Groq media-understanding provider.",
    "/openclaw/plugins/groq-provider",
    "/app-icons/groq.svg",
  ],
  deepinfra: [
    "DeepInfra",
    "DeepInfra model provider for OpenClaw.",
    "/openclaw/plugins/deepinfra-provider",
    "/app-icons/deepinfra.svg",
  ],
  cerebras: [
    "Cerebras",
    "Cerebras model provider for OpenClaw.",
    "/openclaw/plugins/cerebras-provider",
    "/app-icons/cerebras.svg",
  ],
  qwen: [
    "Qwen Cloud",
    "Qwen Cloud provider for OpenClaw.",
    "/openclaw/plugins/qwen-provider",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/qwen.svg",
  ],
  "llama-cpp": [
    "llama.cpp",
    "Local embedding provider through llama.cpp.",
    "/openclaw/plugins/llama-cpp-provider",
    "/app-icons/llama-cpp.svg",
  ],
  "apple-pim": [
    "Apple PIM",
    "Calendar, Reminders, Contacts, and Mail on macOS.",
    "/plugins/apple-pim-cli",
    "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/apple.svg",
  ],
};

const categories = [
  [
    "Popular",
    [
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
    ],
  ],
  [
    "Chat",
    [
      "whatsapp",
      "slack",
      "discord",
      "msteams",
      "googlechat",
      "feishu",
      "matrix",
      "nextcloud-talk",
      "voice-call",
      "line",
      "twitch",
      "qqbot",
    ],
  ],
  [
    "Docs & specs",
    [
      "notion",
      "obsidian",
      "google-drive",
      "google-sheets",
      "airtable",
      "dropbox",
      "linear",
      "jira",
      "github",
      "figma",
      "trello",
      "apple-pim",
    ],
  ],
  [
    "Web",
    [
      "chrome",
      "brave",
      "parallel",
      "perplexity",
      "exa",
      "firecrawl",
      "scraperapi",
      "google-meet",
      "github",
      "figma",
      "google-drive",
      "google-sheets",
    ],
  ],
  [
    "Cloud",
    [
      "aws",
      "docker",
      "kubernetes",
      "gitlab",
      "diagnostics-prometheus",
      "amazon-bedrock",
      "cloudflare-gateway",
      "groq",
      "deepinfra",
      "cerebras",
      "qwen",
      "llama-cpp",
    ],
  ],
] as const;

const emptySearch = {
  q: undefined,
  sort: undefined,
  dir: undefined,
  highlighted: undefined,
  view: undefined,
  focus: undefined,
};

afterEach(() => {
  cleanup();
  destinations.clear();
});

describe("HomeAppsSection", () => {
  it("starts on Popular and preserves all five ordered categories and 47 tile identities", () => {
    const { container } = render(<HomeAppsSection />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(
      categories.map(([label]) => label),
    );
    expect(screen.getByRole("tab", { name: "Popular" }).getAttribute("aria-selected")).toBe("true");
    const seen = new Set<string>();

    for (const [label, ids] of categories) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      expect(
        screen.getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true"),
      ).toEqual([screen.getByRole("tab", { name: label })]);
      const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(".home-v2-apps-tile"));
      expect(links).toHaveLength(12);
      expect(
        links.map((link) => link.querySelector(".home-v2-apps-tile-name")?.textContent),
      ).toEqual(ids.map((id) => tiles[id][0]));
      for (const [index, id] of ids.entries()) {
        seen.add(id);
        const link = links[index];
        const [name, description, destination, iconUrl] = tiles[id];
        expect(link.title).toBe(description);
        expect(link.querySelector(".home-v2-apps-tile-name")?.textContent).toBe(name);
        expect(link.querySelector(".home-v2-apps-tile-meta")?.textContent).toBe(description);
        expect(destinations.get(description)).toEqual(
          destination.startsWith("/")
            ? { to: destination, search: undefined }
            : { to: "/skills", search: { ...emptySearch, q: destination } },
        );
        const icon = link.querySelector<HTMLElement>(`.home-v2-apps-tile-logo--${id}`)!;
        expect(icon).toBeTruthy();
        expect(icon.parentElement?.getAttribute("aria-hidden")).toBe("true");
        if (iconUrl.startsWith("/")) {
          expect(icon.tagName).toBe("IMG");
          expect(icon.getAttribute("src")).toBe(iconUrl);
          expect(icon.getAttribute("loading")).toBe("lazy");
          expect(icon.getAttribute("decoding")).toBe("async");
          expect(icon.getAttribute("alt")).toBe("");
          expect(icon.getAttribute("width")).toBe("40");
          expect(icon.getAttribute("height")).toBe("40");
        } else {
          expect(icon.tagName).toBe("SPAN");
          expect(icon.style.getPropertyValue("--home-v2-apps-icon-url")).toBe(`url("${iconUrl}")`);
          expect(icon.dataset.simpleIconSlug).toBe(iconUrl.split("/").at(-1)?.replace(".svg", ""));
        }
      }
    }
    expect(seen.size).toBe(47);
  });

  it("preserves the workflow header, deferred images and unfiltered browse destination", () => {
    const { container } = render(<HomeAppsSection />);
    expect(
      screen.getByRole("heading", { name: "Skills for the apps you already use" }),
    ).toBeTruthy();
    expect(
      container.querySelector(".home-v2-apps-workflow-tiles")?.getAttribute("aria-hidden"),
    ).toBe("true");
    const images = Array.from(container.querySelectorAll(".home-v2-apps-workflow-tiles img"));
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "/openai-favicon.svg",
      "/slack-favicon.svg",
      "https://openclaw.ai/favicon.svg",
    ]);
    for (const image of images) {
      expect(image.getAttribute("loading")).toBe("lazy");
      expect(image.getAttribute("decoding")).toBe("async");
      expect(image.getAttribute("alt")).toBe("");
      expect(image.getAttribute("width")).toBe("46");
      expect(image.getAttribute("height")).toBe("46");
    }
    expect(screen.getByText("Exfoliate!")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse all skills" }).getAttribute("href")).toBe(
      "/skills",
    );
    expect(destinations.get("footer")).toEqual({ to: "/skills", search: emptySearch });
  });
});
