import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Cloud,
  FileText,
  Globe,
  MessagesSquare,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { type CSSProperties, useMemo, useState } from "react";
import {
  HOME_PLUGIN_SHORTCUTS,
  HOME_SKILL_APPS,
  homePluginShortcutIcon,
  homeSkillAppIcon,
  SKILLS_BROWSE_SEARCH,
  type HomeAppIcon,
  type HomePluginShortcut,
  type HomeSkillApp,
} from "../lib/homeApps";
import { buildPluginDetailHref } from "../lib/pluginRoutes";

type HomeAppIconMarkProps = {
  icon: HomeAppIcon;
  className?: string;
};

function HomeAppIconMark({ icon, className }: HomeAppIconMarkProps) {
  if (icon.kind === "image") {
    return (
      <img
        src={icon.src}
        className={`${className ?? ""} home-v2-apps-icon-mark--image`.trim()}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <span
      className={`${className ?? ""} home-v2-apps-icon-mark--simple`.trim()}
      data-simple-icon-slug={icon.slug}
      style={
        {
          "--home-simple-icon-color": icon.color,
          "--home-simple-icon-url": `url("${icon.src}")`,
        } as CSSProperties
      }
    />
  );
}

function HomeAppsCompactSkill({ app }: { app: HomeSkillApp }) {
  const icon = homeSkillAppIcon(app);

  return (
    <Link
      to="/skills"
      search={{ ...SKILLS_BROWSE_SEARCH, q: app.browseQuery }}
      className="home-v2-apps-tile"
      title={app.description}
    >
      <span className="home-v2-apps-tile-icon" aria-hidden="true">
        <HomeAppIconMark icon={icon} className={homeAppsTileLogoClassName(app.id)} />
      </span>
      <span className="home-v2-apps-tile-copy">
        <span className="home-v2-apps-tile-name">{app.name}</span>
        <span className="home-v2-apps-tile-meta">{app.description}</span>
      </span>
      <ArrowRight className="home-v2-apps-tile-arrow" size={14} aria-hidden="true" />
    </Link>
  );
}

function HomeAppsCompactPlugin({ plugin: shortcut }: { plugin: HomePluginShortcut }) {
  const icon = homePluginShortcutIcon(shortcut);

  return (
    <Link
      to={buildPluginDetailHref(shortcut.packageName)}
      className="home-v2-apps-tile"
      title={shortcut.description}
    >
      <span className="home-v2-apps-tile-icon" aria-hidden="true">
        <HomeAppIconMark icon={icon} className={homeAppsTileLogoClassName(shortcut.id)} />
      </span>
      <span className="home-v2-apps-tile-copy">
        <span className="home-v2-apps-tile-name">{shortcut.name}</span>
        <span className="home-v2-apps-tile-meta">{shortcut.description}</span>
      </span>
      <ArrowRight className="home-v2-apps-tile-arrow" size={14} aria-hidden="true" />
    </Link>
  );
}

type HomeAppsItemRef = {
  kind: "skill" | "plugin";
  id: string;
};

function skill(id: string): HomeAppsItemRef {
  return { kind: "skill", id };
}

function plugin(id: string): HomeAppsItemRef {
  return { kind: "plugin", id };
}

function homeAppsTileLogoClassName(id: string) {
  return `home-v2-apps-tile-logo home-v2-apps-tile-logo--${id}`;
}

function workflowSimpleIcon(id: string) {
  return homeSkillAppIcon({
    id,
    name: id,
    description: "",
    browseQuery: id,
    iconDomain: "",
  });
}

const appCategories = [
  {
    id: "popular",
    label: "Popular",
    icon: Sparkles as LucideIcon,
    items: [
      skill("github"),
      skill("vscode"),
      skill("notion"),
      skill("slack"),
      skill("gmail"),
      skill("google-drive"),
      skill("google-sheets"),
      skill("google-calendar"),
      skill("linear"),
      skill("figma"),
      skill("trello"),
      plugin("whatsapp"),
    ],
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessagesSquare as LucideIcon,
    items: [
      plugin("whatsapp"),
      skill("slack"),
      skill("discord"),
      plugin("msteams"),
      plugin("googlechat"),
      plugin("feishu"),
      plugin("matrix"),
      plugin("nextcloud-talk"),
      plugin("voice-call"),
      plugin("line"),
      plugin("twitch"),
      plugin("qqbot"),
    ],
  },
  {
    id: "docs",
    label: "Docs & specs",
    icon: FileText as LucideIcon,
    items: [
      skill("notion"),
      skill("obsidian"),
      skill("google-drive"),
      skill("google-sheets"),
      skill("airtable"),
      skill("dropbox"),
      skill("linear"),
      skill("jira"),
      skill("github"),
      skill("figma"),
      skill("trello"),
      plugin("apple-pim"),
    ],
  },
  {
    id: "web",
    label: "Web",
    icon: Globe as LucideIcon,
    items: [
      skill("chrome"),
      plugin("brave"),
      plugin("parallel"),
      plugin("perplexity"),
      plugin("exa"),
      plugin("firecrawl"),
      plugin("scraperapi"),
      plugin("google-meet"),
      skill("github"),
      skill("figma"),
      skill("google-drive"),
      skill("google-sheets"),
    ],
  },
  {
    id: "cloud",
    label: "Cloud",
    icon: Cloud as LucideIcon,
    items: [
      skill("aws"),
      skill("docker"),
      skill("kubernetes"),
      skill("gitlab"),
      plugin("diagnostics-prometheus"),
      plugin("amazon-bedrock"),
      plugin("cloudflare-gateway"),
      plugin("groq"),
      plugin("deepinfra"),
      plugin("cerebras"),
      plugin("qwen"),
      plugin("llama-cpp"),
    ],
  },
] as const;

const workflowHeaderTiles: ReadonlyArray<{
  label: string;
  icon: HomeAppIcon;
  className: string;
  badge?: string;
}> = [
  {
    label: "OpenAI",
    icon: workflowSimpleIcon("openai"),
    className: "is-openai",
  },
  {
    label: "Slack",
    icon: workflowSimpleIcon("slack"),
    className: "is-slack",
  },
  {
    label: "OpenClaw",
    icon: workflowSimpleIcon("openclaw"),
    className: "is-openclaw",
    badge: "Exfoliate!",
  },
];

export function HomeAppsSection() {
  const [activeCategoryId, setActiveCategoryId] = useState<(typeof appCategories)[number]["id"]>(
    appCategories[0].id,
  );
  const compactItems = useMemo(() => {
    const activeCategory =
      appCategories.find((category) => category.id === activeCategoryId) ?? appCategories[0];
    return activeCategory.items
      .map((item) => {
        if (item.kind === "skill") {
          const app = HOME_SKILL_APPS.find((candidate) => candidate.id === item.id);
          return app ? { kind: "skill" as const, app } : null;
        }
        const matchedPlugin = HOME_PLUGIN_SHORTCUTS.find((candidate) => candidate.id === item.id);
        return matchedPlugin ? { kind: "plugin" as const, plugin: matchedPlugin } : null;
      })
      .filter(
        (
          item,
        ): item is
          | { kind: "skill"; app: HomeSkillApp }
          | { kind: "plugin"; plugin: HomePluginShortcut } => Boolean(item),
      );
  }, [activeCategoryId]);

  return (
    <section className="home-v2-apps" aria-labelledby="home-v2-apps-title">
      <div className="home-v2-apps-stage">
        <div className="home-v2-apps-workflow-header">
          <div className="home-v2-apps-workflow-copy">
            <h2 id="home-v2-apps-title">Skills for the apps you already use</h2>
            <p>
              Ready-made skills and gateway plugins that plug OpenClaw straight into your everyday
              tools.
            </p>
          </div>
          <div className="home-v2-apps-workflow-tiles" aria-hidden="true">
            {workflowHeaderTiles.map((tile) => (
              <span key={tile.label} className={`home-v2-apps-workflow-tile ${tile.className}`}>
                {tile.badge ? (
                  <span className="home-v2-apps-workflow-badge">{tile.badge}</span>
                ) : null}
                <HomeAppIconMark icon={tile.icon} className="home-v2-apps-workflow-logo" />
              </span>
            ))}
          </div>
        </div>

        <div className="home-v2-apps-categories" role="tablist" aria-label="App categories">
          {appCategories.map((category) => {
            const Icon = category.icon;
            return (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={category.id === activeCategoryId}
                className="home-v2-apps-category-tab"
                onClick={() => setActiveCategoryId(category.id)}
              >
                <Icon className="home-v2-apps-category-tab-icon" size={14} aria-hidden="true" />
                {category.label}
              </button>
            );
          })}
        </div>

        <div className="home-v2-apps-tile-grid" aria-label="App and plugin shortcuts">
          {compactItems.map((item) =>
            item.kind === "skill" ? (
              <HomeAppsCompactSkill key={`skill-${item.app.id}`} app={item.app} />
            ) : (
              <HomeAppsCompactPlugin key={`plugin-${item.plugin.id}`} plugin={item.plugin} />
            ),
          )}
        </div>

        <div className="home-v2-apps-see-all-row">
          <Link to="/skills" search={SKILLS_BROWSE_SEARCH} className="home-v2-apps-see-all">
            Browse all skills
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
