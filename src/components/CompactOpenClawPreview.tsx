import { ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import type { ThemePreviewPalette } from "../../convex/lib/pluginThemes";
import { themeBackgroundTokens, themePaletteToPreviewTokens } from "../lib/themePreviewTokens";

type CompactOpenClawPreviewProps = {
  messages: ReadonlyArray<{ role: "user" | "assistant"; content: ReactNode }>;
  /** Session list beside the chat; the first entry is the active session. */
  sessions?: readonly string[];
  /** Restyles only this window with a portable OpenClaw theme palette. */
  palette?: ThemePreviewPalette;
  /** Hosted theme canvas image for the palette's mode, shown behind the content. */
  background?: { url: string; mode: "light" | "dark" };
};

/** A compact OpenClaw chat window: window bar, messages and composer, in Carapace tokens. */
export function CompactOpenClawPreview({
  messages,
  sessions,
  palette,
  background,
}: CompactOpenClawPreviewProps) {
  const backdrop = background && themeBackgroundTokens(background.url, background.mode);
  const chat = (
    <>
      {messages.map((message, index) =>
        message.role === "user" ? (
          <p key={index} className="plugin-prompt-preview-message">
            {message.content}
          </p>
        ) : (
          <div key={index} className="plugin-prompt-preview-reply">
            {message.content}
          </div>
        ),
      )}
      <div className="plugin-prompt-preview-composer" aria-hidden="true">
        <span>Message OpenClaw</span>
        <ArrowUp size={14} />
      </div>
    </>
  );
  return (
    <figure
      className={`plugin-prompt-preview${palette ? " plugin-prompt-preview-themed" : ""}${
        backdrop ? " plugin-prompt-preview-backdrop" : ""
      }`}
      aria-label="OpenClaw chat preview"
      style={palette ? { ...themePaletteToPreviewTokens(palette), ...backdrop } : undefined}
    >
      <div className="plugin-prompt-preview-bar" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      {sessions?.length ? (
        <div className="plugin-prompt-preview-body">
          <ul className="plugin-prompt-preview-sessions" aria-label="Sessions">
            {sessions.map((session, index) => (
              <li key={session} aria-current={index === 0 ? "true" : undefined}>
                {session}
              </li>
            ))}
          </ul>
          <div className="plugin-prompt-preview-chat">{chat}</div>
        </div>
      ) : (
        chat
      )}
    </figure>
  );
}
