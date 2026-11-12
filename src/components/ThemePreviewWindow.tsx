import {
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  House,
  Inbox,
  LayoutDashboard,
  List,
  ListFilter,
  MessageSquare,
  Mic,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Shield,
  Square,
  SquareCheck,
  ThumbsUp,
  Users,
} from "lucide-react";
import type { ThemePreview } from "../../convex/lib/pluginThemes";
import { themeBackgroundTokens, themePaletteToPreviewTokens } from "../lib/themePreviewTokens";

type ThemePreviewWindowProps = {
  theme: ThemePreview;
  mode: "light" | "dark";
  /** `card` is the same window scaled down for catalog cards, without composer extras. */
  size?: "card" | "large";
};

/**
 * A static OpenClaw Control UI chat screen in a theme's colors. Layout and proportions
 * follow the real app and scale with the container width; colors follow its rules:
 * primary for new session, send and primary actions, accent for links, neutral selected
 * rows and user bubble, theme fonts, and the mode's background image behind the canvas.
 * The content is a fixed demo, not a real conversation.
 */
export function ThemePreviewWindow({ theme, mode, size = "large" }: ThemePreviewWindowProps) {
  const palette = theme[mode] ?? theme.light ?? theme.dark;
  if (!palette) return null;
  const backdrop = themeBackgroundTokens(theme.backgrounds?.[mode], mode);
  return (
    <div className={`theme-window-frame theme-window-${size}`}>
      <figure
        className={`theme-window${backdrop ? " theme-window-backdrop" : ""}`}
        data-mode={mode}
        aria-label={`${theme.name} theme preview, ${mode} mode`}
        style={{ ...themePaletteToPreviewTokens(palette), ...backdrop }}
      >
        <div className="theme-window-titlebar" aria-hidden="true">
          <span className="theme-window-lights">
            <i />
            <i />
            <i />
          </span>
          <span className="theme-window-tools">
            <PanelLeft />
            <Search />
            <ChevronLeft />
            <ChevronRight />
          </span>
          <span className="theme-window-crumbs">
            <span>Design studio</span>
            <span>/</span>
            <strong>Organize project notes</strong>
            <Ellipsis />
          </span>
          <span className="theme-window-tools">
            <Users />
            <List />
            <PanelRight />
          </span>
        </div>
        <div className="theme-window-body" aria-hidden="true">
          <nav className="theme-window-rail">
            <span className="theme-window-avatar">OC</span>
            <span className="theme-window-new">
              <Plus />
            </span>
            <hr />
            <span>
              <LayoutDashboard />
            </span>
            <span aria-current="true">
              <MessageSquare />
            </span>
            <span>
              <Users />
            </span>
            <span className="theme-window-rail-end">
              <House />
            </span>
            <span>
              <Inbox />
            </span>
            <span className="theme-window-avatar theme-window-me">JH</span>
          </nav>
          <aside className="theme-window-sessions">
            <div className="theme-window-sessions-head">
              <span>Sessions</span>
              <ListFilter />
            </div>
            <ul>
              <li>Choose a simple dinner</li>
              <li aria-current="true">Organize project notes</li>
              <li>Plan a weekend trip</li>
            </ul>
          </aside>
          <div className="theme-window-chat">
            <div className="theme-window-thread">
              <p className="theme-window-user">
                Collect the decisions from this design review and turn them into a short checklist.
              </p>
              <div className="theme-window-reply">
                <div className="theme-window-author">
                  <span className="theme-window-avatar">OC</span>
                  <strong>OpenClaw</strong>
                </div>
                <p>Here's the checklist from the review:</p>
                <ul>
                  <li>
                    <SquareCheck className="is-done" /> Keep the compact sidebar on small screens
                  </li>
                  <li>
                    <SquareCheck className="is-done" /> Move export into the{" "}
                    <span className="theme-window-link">share menu</span>
                  </li>
                  <li>
                    <Square /> Send the revised mockups by Friday
                  </li>
                </ul>
                <div className="theme-window-actions">
                  <Copy />
                  <ThumbsUp />
                </div>
              </div>
            </div>
            <div className="theme-window-composer">
              <span className="theme-window-placeholder">Message OpenClaw</span>
              <div className="theme-window-composer-row">
                <Plus />
                <span className="theme-window-chip">
                  <Shield /> Full access
                </span>
                <span className="theme-window-chip">
                  Claude Sonnet <ChevronDown />
                </span>
                <Mic className="theme-window-mic" />
                <span className="theme-window-send">
                  <ArrowUp />
                </span>
              </div>
            </div>
          </div>
        </div>
      </figure>
    </div>
  );
}
