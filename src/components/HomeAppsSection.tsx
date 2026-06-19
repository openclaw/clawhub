import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Cloud,
  Code2,
  FileText,
  Globe,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  HOME_PLUGIN_SHORTCUTS,
  HOME_SKILL_APPS,
  homeAppIconUrl,
  homePluginShortcutIconUrl,
  SKILLS_BROWSE_SEARCH,
  type HomePluginShortcut,
  type HomeSkillApp,
} from "../lib/homeApps";
import { OPENCLAW_LOGO_URL } from "../lib/nav-items";

function HomeAppsCompactSkill({ app }: { app: HomeSkillApp }) {
  return (
    <Link
      to="/skills"
      search={{ ...SKILLS_BROWSE_SEARCH, q: app.browseQuery }}
      className="home-v2-apps-tile"
      title={app.description}
    >
      <span className="home-v2-apps-tile-icon" aria-hidden="true">
        <img
          src={homeAppIconUrl(app.iconDomain)}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
        />
      </span>
      <span className="home-v2-apps-tile-copy">
        <span className="home-v2-apps-tile-name">{app.name}</span>
        <span className="home-v2-apps-tile-meta">{app.description}</span>
      </span>
      <ArrowRight className="home-v2-apps-tile-arrow" size={14} aria-hidden="true" />
    </Link>
  );
}

function HomeAppsCompactPlugin({ plugin }: { plugin: HomePluginShortcut }) {
  return (
    <Link
      to="/plugins/$name"
      params={{ name: plugin.packageName }}
      className="home-v2-apps-tile"
      title={plugin.description}
    >
      <span className="home-v2-apps-tile-icon" aria-hidden="true">
        <img
          src={homePluginShortcutIconUrl(plugin)}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
        />
      </span>
      <span className="home-v2-apps-tile-copy">
        <span className="home-v2-apps-tile-name">{plugin.name}</span>
        <span className="home-v2-apps-tile-meta">{plugin.description}</span>
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

const appCategories = [
  {
    id: "code",
    label: "Code",
    icon: Code2 as LucideIcon,
    items: [
      skill("github"),
      skill("vscode"),
      skill("cursor"),
      plugin("codex"),
      skill("raycast"),
      skill("aws"),
      skill("linear"),
      skill("notion"),
      plugin("brave"),
      skill("chrome"),
      skill("figma"),
      plugin("slack"),
    ],
  },
  {
    id: "chat",
    label: "Chat",
    icon: MessagesSquare as LucideIcon,
    items: [
      plugin("slack"),
      plugin("discord"),
      plugin("msteams"),
      plugin("googlechat"),
      plugin("whatsapp"),
      plugin("matrix"),
      plugin("feishu"),
      skill("raycast"),
      skill("github"),
    ],
  },
  {
    id: "docs",
    label: "Docs & specs",
    icon: FileText as LucideIcon,
    items: [
      skill("notion"),
      skill("linear"),
      skill("github"),
      skill("figma"),
      skill("cursor"),
      skill("vscode"),
      skill("chrome"),
      skill("raycast"),
      plugin("codex"),
    ],
  },
  {
    id: "web",
    label: "Web",
    icon: Globe as LucideIcon,
    items: [
      skill("chrome"),
      plugin("brave"),
      skill("raycast"),
      skill("github"),
      skill("notion"),
      skill("figma"),
      plugin("slack"),
      plugin("discord"),
      plugin("codex"),
    ],
  },
  {
    id: "cloud",
    label: "Cloud",
    icon: Cloud as LucideIcon,
    items: [
      skill("aws"),
      skill("github"),
      plugin("codex"),
      skill("vscode"),
      skill("cursor"),
      skill("raycast"),
      plugin("slack"),
      plugin("msteams"),
      skill("linear"),
    ],
  },
] as const;

const slackWorkflowPlugin =
  HOME_PLUGIN_SHORTCUTS.find((plugin) => plugin.id === "slack") ?? HOME_PLUGIN_SHORTCUTS[0];

const workflowHeaderTiles: ReadonlyArray<{
  label: string;
  src: string;
  className: string;
  badge?: string;
}> = [
  {
    label: "OpenAI",
    src: homeAppIconUrl("openai.com"),
    className: "is-openai",
  },
  {
    label: "Slack",
    src: homePluginShortcutIconUrl(slackWorkflowPlugin),
    className: "is-slack",
  },
  {
    label: "OpenClaw",
    src: OPENCLAW_LOGO_URL,
    className: "is-openclaw",
    badge: "Exfoliate!",
  },
];

export function HomeAppsSection() {
  const [activeCategoryId, setActiveCategoryId] = useState<(typeof appCategories)[number]["id"]>(appCategories[0].id);
  const compactItems = useMemo(() => {
    const activeCategory = appCategories.find((category) => category.id === activeCategoryId) ?? appCategories[0];
    return activeCategory.items
      .map((item) => {
        if (item.kind === "skill") {
          const app = HOME_SKILL_APPS.find((candidate) => candidate.id === item.id);
          return app ? ({ kind: "skill" as const, app }) : null;
        }
        const matchedPlugin = HOME_PLUGIN_SHORTCUTS.find((candidate) => candidate.id === item.id);
        return matchedPlugin ? ({ kind: "plugin" as const, plugin: matchedPlugin }) : null;
      })
      .filter((item): item is { kind: "skill"; app: HomeSkillApp } | { kind: "plugin"; plugin: HomePluginShortcut } =>
        Boolean(item)
      );
  }, [activeCategoryId]);

  return (
    <section className="home-v2-apps" aria-labelledby="home-v2-apps-title">
      <div className="home-v2-apps-stage">
        <div className="home-v2-apps-workflow-header">
          <div className="home-v2-apps-workflow-copy">
            <h2 id="home-v2-apps-title">Skills for the apps you already use</h2>
            <p>Ready-made skills and gateway plugins that plug OpenClaw straight into your everyday tools.</p>
          </div>
          <div className="home-v2-apps-workflow-tiles" aria-hidden="true">
            {workflowHeaderTiles.map((tile) => (
              <span
                key={tile.label}
                className={`home-v2-apps-workflow-tile ${tile.className}`}
              >
                {tile.badge ? <span>{tile.badge}</span> : null}
                <img src={tile.src} alt="" width={46} height={46} loading="lazy" decoding="async" />
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
            )
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
