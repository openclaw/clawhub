import { Link } from "@tanstack/react-router";
import { ArrowRight, Sparkles } from "lucide-react";
import type { PointerEvent } from "react";
import { useState } from "react";
import { InstallCopyButton } from "./InstallCopyButton";

const BYOS_ASCII = [
  "....:: clawhub/openclaw ::....  skills plugins publishers trust signals",
  ">>> install scan publish verify    @@ gateway @@ registry @@ agents @@",
  "  30 skills 12 plugins    /api/v1/skills   /owners   /audit   /ship",
  ":::: signed manifests ::::: moderated releases ::::: version history ::::",
  "  hooks runners slash-commands skill.md templates scanners review-bots",
  "openclaw ecosystem    crabbox clickclack crawler packs gateway plugins",
  "---- downloads installs stars lineage ownership docs package integrity",
  "  safe browse paths   official gateways   publisher handles   org trust",
];
const BYOS_ASCII_FIELD = Array.from({ length: 56 }, (_, row) => {
  const a = BYOS_ASCII[row % BYOS_ASCII.length];
  const b = BYOS_ASCII[(row + 3) % BYOS_ASCII.length];
  const c = BYOS_ASCII[(row + 5) % BYOS_ASCII.length];
  return `${a}   ${b}   ${c}`;
}).join("\n");

// Same composition as the footer easter egg, rendered full-bleed with a static
// image stack plus the pointer-tracked ASCII glow that reveals on hover.
function ByosRevealBackdrop() {
  return (
    <div className="home-v2-byos-reveal" aria-hidden="true">
      <div className="home-v2-byos-reveal-image home-v2-byos-reveal-image--base" />
      <div className="home-v2-byos-reveal-scrim" />
      <pre className="home-v2-byos-reveal-ascii">{BYOS_ASCII_FIELD}</pre>
      <div className="home-v2-byos-reveal-image home-v2-byos-reveal-image--top" />
    </div>
  );
}

type TerminalLine = { text: string; comment?: boolean };
type Audience = "humans" | "agents";

type TerminalTab = {
  id: Audience;
  label: string;
  mode: "terminal";
  termLabel: string;
  lines: TerminalLine[];
};

type PromptTab = {
  id: Audience;
  label: string;
  mode: "prompt";
  promptLabel: string;
  prompt: string;
};

type AudienceTab = TerminalTab | PromptTab;

const AGENT_PROMPT =
  "Read docs.openclaw.ai/clawhub, verify my skills are publish-ready, then publish them to ClawHub and report the published URLs.";

const TABS: AudienceTab[] = [
  {
    id: "agents",
    label: "For agents",
    mode: "prompt",
    promptLabel: "agent prompt",
    prompt: AGENT_PROMPT,
  },
  {
    id: "humans",
    label: "For humans",
    mode: "terminal",
    termLabel: "clawhub — publish & sync",
    lines: [
      { text: "npm i -g clawhub" },
      { text: "clawhub login" },
      { text: "clawhub skill publish ./my-skill --slug my-skill --version 1.0.0" },
      { text: "clawhub package publish your-org/your-plugin" },
      { text: "clawhub sync --all" },
    ],
  },
];

function copyTextFor(tab: TerminalTab) {
  return tab.lines
    .filter((line) => !line.comment)
    .map((line) => line.text)
    .join("\n");
}

function GitHubGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="home-v2-byos-import-icon"
      aria-hidden="true"
    >
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function Terminal({ tab }: { tab: TerminalTab }) {
  return (
    <div className="home-v2-byos-term">
      <div className="home-v2-byos-term-bar" aria-hidden="true">
        <span className="home-v2-byos-term-dot" />
        <span className="home-v2-byos-term-dot" />
        <span className="home-v2-byos-term-dot" />
        <span className="home-v2-byos-term-label">{tab.termLabel}</span>
      </div>
      <div className="home-v2-byos-term-body">
        <pre className="home-v2-byos-code" tabIndex={0}>
          <code translate="no">
            {tab.lines.map((line) => (
              <span className="home-v2-byos-line" key={line.text}>
                {line.comment ? (
                  <span className="home-v2-byos-comment">{line.text}</span>
                ) : (
                  <>
                    <span className="home-v2-byos-prompt">$ </span>
                    <span className="home-v2-byos-cmd">{line.text}</span>
                  </>
                )}
              </span>
            ))}
          </code>
        </pre>
        <InstallCopyButton
          text={copyTextFor(tab)}
          ariaLabel={`Copy ${tab.label} commands`}
          className="home-v2-byos-copy"
          showLabel={false}
        />
      </div>
    </div>
  );
}

function PromptCard({ tab }: { tab: PromptTab }) {
  return (
    <div className="home-v2-byos-term home-v2-byos-prompt-card">
      <div className="home-v2-byos-term-bar" aria-hidden="true">
        <Sparkles size={13} className="home-v2-byos-prompt-spark" />
        <span className="home-v2-byos-term-label">{tab.promptLabel}</span>
      </div>
      <div className="home-v2-byos-term-body">
        <p className="home-v2-byos-prompt-text">{tab.prompt}</p>
        <InstallCopyButton
          text={tab.prompt}
          ariaLabel={`Copy ${tab.label} prompt`}
          className="home-v2-byos-copy"
          showLabel={false}
        />
      </div>
    </div>
  );
}

export function HomeBringSkillsSection() {
  const [audience, setAudience] = useState<Audience>("humans");
  const activeTab = TABS.find((tab) => tab.id === audience) ?? TABS[0];

  // Drive the backdrop reveal from the whole section so it tracks the cursor
  // even while hovering the heading, tabs, or command card on top.
  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--byos-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--byos-y", `${event.clientY - rect.top}px`);
    event.currentTarget.style.setProperty("--byos-intensity", "1");
  };

  const handlePointerLeave = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty("--byos-intensity", "0");
  };

  return (
    <section
      className="home-v2-byos"
      aria-labelledby="home-v2-byos-title"
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <ByosRevealBackdrop />
      <div className="home-v2-byos-content">
        <header className="home-v2-byos-head">
          <span className="home-v2-byos-eyebrow">ClawHub CLI</span>
          <h2 id="home-v2-byos-title" className="home-v2-byos-title">
            Bring your skills to ClawHub
          </h2>
          <p className="home-v2-byos-lede">Publish and sync your skills to ClawHub, your way.</p>
        </header>

        <div className="home-v2-byos-tabs" role="tablist" aria-label="Choose an audience">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`home-v2-byos-tab-${tab.id}`}
              aria-selected={tab.id === audience}
              aria-controls="home-v2-byos-panel"
              className="home-v2-byos-tab"
              onClick={() => setAudience(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id="home-v2-byos-panel"
          role="tabpanel"
          aria-labelledby={`home-v2-byos-tab-${activeTab.id}`}
          className="home-v2-byos-panel"
        >
          {activeTab.mode === "terminal" ? (
            <Terminal tab={activeTab} />
          ) : (
            <PromptCard tab={activeTab} />
          )}
        </div>

        <div className="home-v2-byos-foot">
          <Link to="/import" className="home-v2-byos-import">
            <GitHubGlyph />
            or import from your GitHub
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
