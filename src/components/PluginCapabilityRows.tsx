import { ChevronRight, Layers } from "lucide-react";
import type { ReactNode } from "react";

// Presentation copy and contribution artwork follow OpenClaw's plugin detail
// (ui/plugin-extensions, 7b608df45256). These describe declared kinds, not runtime checks.
export const PLUGIN_EXTENSION_LABELS = {
  page: ["Pages", "Adds dedicated plugin pages in the web app."],
  navigation: ["Navigation", "Adds destinations to the app sidebar."],
  panel: ["Panels", "Adds panels you can open beside a conversation."],
  action: [
    "Actions",
    "Adds buttons or menu items in the composer, session header, or session menu.",
  ],
  accessory: ["Session accessories", "Shows information or controls in the session header."],
  widget: ["Dashboard widgets", "Adds widgets you can place on session dashboards."],
  inline: ["Inline views", "Shows interactive plugin content within chat messages."],
  replacement: ["Interface replacements", "Offers alternate OpenClaw app views."],
  "link-reader": [
    "Link previews",
    "Opens supported links in a plugin-provided reader inside the web app.",
  ],
} as const;

export const PLUGIN_CAPABILITY_FAMILIES: Record<string, readonly [string, string]> = {
  speechProviders: ["Text to speech", "Turn text into spoken audio."],
  realtimeTranscriptionProviders: ["Live transcription", "Transcribe audio as it arrives."],
  realtimeVoiceProviders: ["Realtime voice", "Support live voice conversations."],
  mediaUnderstandingProviders: ["Media understanding", "Analyze supported media inputs."],
  imageGenerationProviders: [
    "Image generation",
    "Create images from prompts and supported references.",
  ],
  videoGenerationProviders: ["Video generation", "Create video with supported generation models."],
  musicGenerationProviders: ["Music generation", "Create music with supported generation models."],
  embeddingProviders: ["Embeddings", "Represent content for semantic search and retrieval."],
  webSearchProviders: ["Web search", "Find information on the web."],
  webFetchProviders: ["Web fetching", "Read content from web pages."],
  webContentExtractors: ["Web content extraction", "Extract readable content from web pages."],
  documentExtractors: ["Document extraction", "Extract content from supported documents."],
  transcriptSourceProviders: [
    "Transcripts",
    "Capture or import transcripts from supported sources.",
  ],
  migrationProviders: ["Migration", "Bring supported data into OpenClaw."],
};

type ExtensionKind = keyof typeof PLUGIN_EXTENSION_LABELS;

export function PluginExtensionIcon({ kind }: { kind: ExtensionKind }) {
  const frame = <rect x="2" y="3" width="20" height="18" rx="2" />;
  const artwork: Record<ExtensionKind, ReactNode> = {
    page: (
      <>
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M4 7h16M8 11h8M8 15h5" />
      </>
    ),
    navigation: (
      <>
        {frame}
        <path d="M9 3v18M5 8h1M5 12h1M5 16h1M13 8h5" />
      </>
    ),
    panel: (
      <>
        {frame}
        <path d="M14 3v18M17 8h2M17 12h2M5 8h5" />
      </>
    ),
    action: (
      <>
        <rect x="2" y="3" width="19" height="12" rx="3" />
        <path d="M6 8h4M13 10l8 7-4 .5-1.5 4-2.5-11.5Z" fill="currentColor" strokeWidth="1.5" />
      </>
    ),
    accessory: (
      <>
        {frame}
        <path d="M2 9h20M5 13h8M5 17h5" />
        <rect x="13" y="5" width="6" height="2" rx="1" fill="currentColor" strokeWidth="0" />
      </>
    ),
    widget: (
      <>
        <rect x="3" y="3" width="7" height="11" rx="1.5" />
        <rect x="14" y="3" width="7" height="6" rx="1.5" />
        <rect x="14" y="13" width="7" height="8" rx="1.5" />
        <path d="M3 18h7M3 21h7" />
      </>
    ),
    inline: (
      <>
        <path d="M3 3h15M3 7h9M3 21h15" />
        <rect x="6" y="11" width="15" height="6" rx="1.5" />
        <path d="M10 14h.01M14 14h3" />
      </>
    ),
    replacement: (
      <>
        <rect x="2" y="2" width="9" height="8" rx="1.5" />
        <rect x="13" y="14" width="9" height="8" rx="1.5" />
        <path d="M15 5h6m-3-3 3 3-3 3M9 19H3m3-3-3 3 3 3" />
      </>
    ),
    "link-reader": (
      <>
        {frame}
        <path d="M2 8h20M6 5.5h.01" />
        <path d="m9 13-1.5 1.5a2.1 2.1 0 0 0 3 3l1.5-1.5m0-3 1.5-1.5a2.1 2.1 0 0 1 3 3L15 16m-5-1 4-1" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {artwork[kind]}
    </svg>
  );
}

export function PluginCapabilitySection({
  id,
  title,
  count,
  icon,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="plugin-content-section" aria-labelledby={"plugin-heading-" + id}>
      <h2 id={"plugin-heading-" + id}>
        {icon ? (
          <span className="plugin-capability-heading-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <span data-plugin-section-title="">{title}</span>
        {count !== undefined ? (
          <span className="plugin-capability-count" aria-hidden="true">
            {count}
          </span>
        ) : null}
      </h2>
      {children}
    </section>
  );
}

export function PluginCapabilityRow({
  name,
  description,
  icon,
  metadata,
  trailing,
  onOpen,
  openLabel,
}: {
  name: string;
  description?: ReactNode;
  icon?: ReactNode;
  metadata?: ReactNode;
  trailing?: ReactNode;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const content = (
    <>
      <span className="plugin-capability-icon" aria-hidden="true">
        {icon ?? <Layers />}
      </span>
      <span className="plugin-capability-copy">
        <strong>{name}</strong>
        {description ? <span className="plugin-capability-description">{description}</span> : null}
        {metadata ? <span className="plugin-capability-declarations">{metadata}</span> : null}
      </span>
      {trailing ? <span className="plugin-capability-trailing">{trailing}</span> : null}
      {onOpen ? <ChevronRight className="plugin-capability-chevron" aria-hidden="true" /> : null}
    </>
  );
  return (
    <div className="plugin-capability-row" role="listitem">
      {onOpen ? (
        <button
          type="button"
          className="plugin-capability-row-body"
          aria-label={openLabel}
          onClick={onOpen}
        >
          {content}
        </button>
      ) : (
        <div className="plugin-capability-row-body">{content}</div>
      )}
    </div>
  );
}
