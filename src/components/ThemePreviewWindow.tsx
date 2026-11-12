import { ArrowUp } from "lucide-react";
import type { ThemePreview } from "../../convex/lib/pluginThemes";
import { themeBackgroundTokens, themePaletteToPreviewTokens } from "../lib/themePreviewTokens";

type ThemePreviewWindowProps = {
  theme: ThemePreview;
  mode: "light" | "dark";
  /** `card` scales the same window down for catalog cards. */
  size?: "card" | "large";
};

/**
 * A static mini Control UI in a theme's colors, using the Control UI's color rules:
 * neutral selected rows and user bubble, accent links, primary buttons and send button,
 * the theme fonts when declared, and the mode's background image behind it.
 * The content is a fixed theme demo, not a real conversation.
 */
export function ThemePreviewWindow({ theme, mode, size = "large" }: ThemePreviewWindowProps) {
  const palette = theme[mode] ?? theme.light ?? theme.dark;
  if (!palette) return null;
  const backdrop = themeBackgroundTokens(theme.backgrounds?.[mode], mode);
  return (
    <figure
      className={`theme-window theme-window-${size}${backdrop ? " theme-window-backdrop" : ""}`}
      data-mode={mode}
      aria-label={`${theme.name} theme preview, ${mode} mode`}
      style={{ ...themePaletteToPreviewTokens(palette), ...backdrop }}
    >
      <div className="theme-window-bar" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="theme-window-body" aria-hidden="true">
        <nav className="theme-window-rail">
          <i aria-current="true" />
          <i />
          <i />
          <i />
        </nav>
        <aside className="theme-window-sessions">
          <span>Sessions</span>
          <ul>
            <li aria-current="true">{theme.name}</li>
            <li>Release notes</li>
            <li>Inbox triage</li>
          </ul>
        </aside>
        <div className="theme-window-chat">
          <p className="theme-window-user">Show me this theme.</p>
          <div className="theme-window-reply">
            <p>
              This is <strong>{theme.name}</strong> in {mode} mode.
            </p>
            <p className="theme-window-muted">
              Muted text, an <span className="theme-window-link">accent link</span> and{" "}
              <code>inline code</code>.
            </p>
            <span className="theme-window-button">Primary</span>
          </div>
          <div className="theme-window-composer">
            <span>Message OpenClaw</span>
            <ArrowUp />
          </div>
        </div>
      </div>
    </figure>
  );
}
