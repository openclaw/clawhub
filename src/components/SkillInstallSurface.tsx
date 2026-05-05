import type { ClawdisSkillMetadata } from "clawhub-schema";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { copyText, InstallCopyButton } from "./InstallCopyButton";
import {
  buildSkillInstallTarget,
  formatOpenClawInstallCommand,
  formatOpenClawPrompt,
  type SkillPromptMode,
} from "./skillDetailUtils";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const PROMPT_OPTIONS: Array<{
  description: string;
  label: string;
  mode: SkillPromptMode;
}> = [
  {
    mode: "install-only",
    label: "Install Only",
    description: "Install the skill and stop there.",
  },
  {
    mode: "install-and-setup",
    label: "Install & Setup",
    description: "Install first, then help finish setup from skill metadata.",
  },
];

type PromptCopyState = "idle" | "copied" | "failed";

type SkillInstallSurfaceProps = {
  slug: string;
  displayName: string;
  ownerHandle: string | null;
  ownerId: Id<"users"> | Id<"publishers"> | null;
  clawdis?: ClawdisSkillMetadata;
};

export function SkillInstallSurface({
  slug,
  displayName,
  ownerHandle,
  ownerId,
  clawdis,
}: SkillInstallSurfaceProps) {
  const headingId = useId();
  const [promptMode, setPromptMode] = useState<SkillPromptMode>("install-and-setup");
  const [promptCopyState, setPromptCopyState] = useState<PromptCopyState>("idle");
  const promptResetTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (promptResetTimeoutRef.current !== null) {
        window.clearTimeout(promptResetTimeoutRef.current);
      }
    },
    [],
  );

  const schedulePromptReset = () => {
    if (promptResetTimeoutRef.current !== null) {
      window.clearTimeout(promptResetTimeoutRef.current);
    }

    promptResetTimeoutRef.current = window.setTimeout(() => {
      setPromptCopyState("idle");
      promptResetTimeoutRef.current = null;
    }, 2000);
  };

  const selectedPrompt =
    PROMPT_OPTIONS.find((option) => option.mode === promptMode) ?? PROMPT_OPTIONS[1];
  const installTarget = buildSkillInstallTarget(ownerHandle, ownerId, slug);
  const promptPreview = formatOpenClawPrompt({
    mode: promptMode,
    skillName: displayName,
    slug,
    ownerHandle,
    ownerId,
    clawdis,
  });

  const promptFeedback =
    promptCopyState === "copied"
      ? `${selectedPrompt.label} prompt copied.`
      : promptCopyState === "failed"
        ? "Copy failed. Try again."
        : `Previewing ${selectedPrompt.label}.`;

  const selectPromptMode = (mode: SkillPromptMode) => {
    const promptText = formatOpenClawPrompt({
      mode,
      skillName: displayName,
      slug,
      ownerHandle,
      ownerId,
      clawdis,
    });

    setPromptMode(mode);

    void copyText(promptText)
      .then((didCopy) => {
        setPromptCopyState(didCopy ? "copied" : "failed");
        schedulePromptReset();
      })
      .catch(() => {
        setPromptCopyState("failed");
        schedulePromptReset();
      });
  };

  return (
    <section className="skill-install-surface" aria-labelledby={headingId}>
      <h2 id={headingId} className="sr-only">
        Install
      </h2>

      <article className="skill-install-panel">
        <div className="skill-install-panel-header">
          <p className="skill-install-kicker">OpenClaw Prompt Flow</p>
          <h3 className="skill-install-panel-title">Install with OpenClaw</h3>
          <p className="skill-install-panel-copy">
            Best for remote or guided setup. Copy the exact prompt, then paste it into OpenClaw for{" "}
            <code translate="no">{installTarget}</code>.
          </p>
        </div>

        <div className="skill-install-actions">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" className="skill-install-prompt-trigger">
                <span>Copy Prompt</span>
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="skill-install-menu">
              {PROMPT_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.mode} onSelect={() => selectPromptMode(option.mode)}>
                  <div className="skill-install-menu-copy">
                    <span className="skill-install-menu-label">{option.label}</span>
                    <span className="skill-install-menu-description">{option.description}</span>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="skill-install-copy-feedback" aria-live="polite">
            {promptFeedback}
          </span>
        </div>

        <div className="skill-install-preview-meta">
          <span className="skill-install-preview-label">Prompt Preview</span>
          <span className="skill-install-preview-mode">{selectedPrompt.label}</span>
        </div>

        <pre className="skill-install-prompt-preview">
          <code translate="no">{promptPreview}</code>
        </pre>
      </article>
    </section>
  );
}

export function SkillCommandLineCard({
  slug,
  displayName,
  ownerHandle,
  ownerId,
  clawdis,
}: SkillInstallSurfaceProps) {
  const [activeInstallTab, setActiveInstallTab] = useState<"cli" | "prompt">("cli");
  const openClawCommand = formatOpenClawInstallCommand(slug);
  const promptPreview = formatOpenClawPrompt({
    mode: "install-and-setup",
    skillName: displayName,
    slug,
    ownerHandle,
    ownerId,
    clawdis,
  });

  return (
    <article className="skill-install-command-card">
      <div className="skill-install-command-header">
        <h3 className="skill-install-panel-title">Install</h3>
        <div className="install-switcher-toggle" role="tablist" aria-label="Install option">
          <button
            type="button"
            role="tab"
            aria-selected={activeInstallTab === "cli"}
            className={`install-switcher-pill${activeInstallTab === "cli" ? " is-active" : ""}`}
            onClick={() => setActiveInstallTab("cli")}
          >
            CLI
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeInstallTab === "prompt"}
            className={`install-switcher-pill${activeInstallTab === "prompt" ? " is-active" : ""}`}
            onClick={() => setActiveInstallTab("prompt")}
          >
            Prompt
          </button>
        </div>
      </div>

      <div className="skill-install-command-wrap">
        <pre
          className={`skill-install-command${
            activeInstallTab === "prompt" ? " skill-install-prompt-compact" : ""
          }`}
        >
          <code translate="no">
            {activeInstallTab === "prompt" ? promptPreview : openClawCommand}
          </code>
        </pre>
        <InstallCopyButton
          text={activeInstallTab === "prompt" ? promptPreview : openClawCommand}
          ariaLabel={
            activeInstallTab === "prompt" ? "Copy OpenClaw prompt" : "Copy OpenClaw CLI command"
          }
          className="skill-install-command-inline-button"
          showLabel={false}
        />
      </div>
    </article>
  );
}
