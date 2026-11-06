import { useId, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { emitAnalytics } from "../lib/analyticsEvents";
import { InstallCopyButton } from "./InstallCopyButton";
import {
  buildSkillInstallTarget,
  buildSkillPageUrl,
  formatOpenClawInstallCommand,
  formatOpenClawPrompt,
  formatSkillsCliInstallCommand,
} from "./skillDetailUtils";
type SkillCommandLineCardProps = {
  slug: string;
  ownerHandle: string | null;
  ownerId: Id<"users"> | Id<"publishers"> | null;
  installTarget?: string;
  skillPageUrl?: string | null;
  secondaryInstall?: {
    label: string;
    command: string;
    copyAriaLabel: string;
  };
};

export function OpenClawCliInstallCommand({ command }: { command: string }) {
  const match = command.match(/^(openclaw (?:skills|plugins) install)( .+)$/);
  if (!match) {
    return <code translate="no">{command}</code>;
  }

  return (
    <code translate="no">
      <span className="skill-install-command-verb">{match[1]}</span>
      <span className="skill-install-command-target">{match[2]}</span>
    </code>
  );
}

export function SkillCommandLineCard({
  slug,
  ownerHandle,
  ownerId,
  installTarget: installTargetOverride,
  skillPageUrl: skillPageUrlOverride,
  secondaryInstall,
}: SkillCommandLineCardProps) {
  const installTarget =
    installTargetOverride ?? buildSkillInstallTarget(ownerHandle, ownerId, slug);
  const skillPageUrl =
    skillPageUrlOverride === undefined
      ? buildSkillPageUrl(ownerHandle, ownerId, slug)
      : skillPageUrlOverride;
  const skillsCliCommand =
    secondaryInstall?.command ??
    (skillPageUrl ? formatSkillsCliInstallCommand(skillPageUrl) : null);

  return (
    <InstallCommandCard
      cliCommand={formatOpenClawInstallCommand(installTarget)}
      prompt={formatOpenClawPrompt(installTarget)}
      secondaryInstall={
        skillsCliCommand
          ? {
              label: secondaryInstall?.label ?? "npx skills",
              command: skillsCliCommand,
              copyAriaLabel: secondaryInstall?.copyAriaLabel ?? "Copy npx skills command",
            }
          : undefined
      }
    />
  );
}

type InstallCommandCardProps = {
  cliCommand: string;
  prompt: string;
  cliCopyAriaLabel?: string;
  secondaryInstall?: {
    label: string;
    command: string;
    copyAriaLabel: string;
  };
};

export function InstallCommandCard({
  cliCommand,
  prompt,
  cliCopyAriaLabel = "Copy OpenClaw CLI command",
  secondaryInstall,
}: InstallCommandCardProps) {
  const headingId = useId();
  type InstallTab = "cli" | "skills" | "prompt";
  const [activeInstallTab, setActiveInstallTab] = useState<InstallTab>("cli");
  const [installTabDirection, setInstallTabDirection] = useState<"left" | "right">("right");
  const activeInstallText =
    activeInstallTab === "prompt"
      ? prompt
      : activeInstallTab === "skills" && secondaryInstall
        ? secondaryInstall.command
        : cliCommand;
  const installTabOrder: InstallTab[] = ["cli", "skills", "prompt"];
  const selectInstallTab = (tab: InstallTab) => {
    if (tab === activeInstallTab) {
      return;
    }

    setInstallTabDirection(
      installTabOrder.indexOf(tab) > installTabOrder.indexOf(activeInstallTab) ? "right" : "left",
    );
    setActiveInstallTab(tab);
    emitAnalytics("select_content", {
      content_type: "install",
      ui_location: "install",
      method: tab,
    });
  };

  return (
    <article className="skill-install-command-card" aria-labelledby={headingId}>
      <div className="skill-install-command-header detail-hero-summary-row">
        <h3 id={headingId} className="skill-install-panel-title">
          Install
        </h3>
        <div className="skill-install-tab-toggle" role="group" aria-label="Install option">
          <button
            type="button"
            className={`skill-install-tab${activeInstallTab === "cli" ? " is-active" : ""}`}
            aria-pressed={activeInstallTab === "cli"}
            onClick={() => selectInstallTab("cli")}
          >
            CLI
          </button>
          {secondaryInstall ? (
            <button
              type="button"
              className={`skill-install-tab${activeInstallTab === "skills" ? " is-active" : ""}`}
              aria-pressed={activeInstallTab === "skills"}
              onClick={() => selectInstallTab("skills")}
            >
              {secondaryInstall.label}
            </button>
          ) : null}
          <button
            type="button"
            className={`skill-install-tab${activeInstallTab === "prompt" ? " is-active" : ""}`}
            aria-pressed={activeInstallTab === "prompt"}
            onClick={() => selectInstallTab("prompt")}
          >
            Prompt
          </button>
        </div>
      </div>

      <div className="skill-install-command-wrap">
        <div
          className={`skill-install-command-shell${
            activeInstallTab !== "prompt" ? " skill-install-command-shell-cli" : ""
          }`}
        >
          {activeInstallTab !== "prompt" ? (
            <span className="skill-install-command-prompt" aria-hidden="true">
              $
            </span>
          ) : null}
          <pre
            key={activeInstallTab}
            data-direction={installTabDirection}
            className={`skill-install-command${
              activeInstallTab === "prompt" ? " skill-install-prompt-compact" : ""
            } skill-install-command-reveal`}
            tabIndex={0}
          >
            {activeInstallTab !== "prompt" ? (
              <OpenClawCliInstallCommand command={activeInstallText} />
            ) : (
              <code translate="no">{activeInstallText}</code>
            )}
          </pre>
          <InstallCopyButton
            analyticsMethod={activeInstallTab}
            text={activeInstallText}
            ariaLabel={
              activeInstallTab === "prompt"
                ? "Copy OpenClaw prompt"
                : activeInstallTab === "skills"
                  ? (secondaryInstall?.copyAriaLabel ?? "Copy npx skills command")
                  : cliCopyAriaLabel
            }
            className="skill-install-command-inline-button"
            showLabel={false}
            variant="ghost"
            size="icon-sm"
          />
        </div>
      </div>
    </article>
  );
}
