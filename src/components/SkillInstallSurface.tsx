import { useId, useState } from "react";
import type { Id } from "../../convex/_generated/dataModel";
import { emitAnalytics } from "../lib/analyticsEvents";
import { InstallCopyButton } from "./InstallCopyButton";
import { OpenClawInstall } from "./OpenClawInstall";
import {
  buildSkillInstallTarget,
  buildSkillPageUrl,
  formatOpenClawInstallCommand,
  formatOpenClawPrompt,
  formatSkillsCliInstallCommand,
} from "./skillDetailUtils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
type SkillCommandLineCardProps = {
  slug: string;
  ownerHandle: string | null;
  ownerId: Id<"users"> | Id<"publishers"> | null;
  installTarget?: string;
  desktopInstall?: { family: "skills"; name: string };
  skillPageUrl?: string | null;
  secondaryInstall?: {
    label: string;
    command: string;
    copyAriaLabel: string;
  };
};

export function OpenClawCliInstallCommand({ command }: { command: string }) {
  const match = command.match(/^(openclaw (?:(?:skills|plugins) install|templates add))( .+)$/);
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
  desktopInstall,
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
      desktopInstall={desktopInstall}
      cliCommand={formatOpenClawInstallCommand(installTarget)}
      prompt={formatOpenClawPrompt(installTarget, "skill")}
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
  desktopInstall?: { family: "plugins" | "skills" | "templates"; name: string };
  copyEnabled?: boolean;
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
  desktopInstall,
  copyEnabled = true,
  cliCommand,
  prompt,
  cliCopyAriaLabel = "Copy OpenClaw CLI command",
  secondaryInstall,
}: InstallCommandCardProps) {
  const headingId = useId();
  type InstallTab = "desktop" | "cli" | "skills" | "prompt";
  // CLI opens first: released desktop apps do not all handle the app link yet.
  const [selectedInstallTab, setActiveInstallTab] = useState<InstallTab>("cli");
  // Eligibility can change after loading; never keep a tab the card no longer offers.
  const activeInstallTab =
    (selectedInstallTab === "desktop" && !desktopInstall) ||
    (desktopInstall && (selectedInstallTab === "prompt" || selectedInstallTab === "skills"))
      ? "cli"
      : selectedInstallTab;
  const [installTabDirection, setInstallTabDirection] = useState<"left" | "right">("right");
  const activeInstallText =
    activeInstallTab === "prompt"
      ? prompt
      : activeInstallTab === "skills" && secondaryInstall
        ? secondaryInstall.command
        : cliCommand;
  const installTabOrder: InstallTab[] = ["cli", "desktop", "skills", "prompt"];
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

  const commandPreview = (
    <pre
      key={activeInstallTab}
      data-direction={installTabDirection}
      className={`skill-install-command${activeInstallTab === "prompt" ? " skill-install-prompt-compact" : ""} skill-install-command-reveal`}
      tabIndex={0}
    >
      {activeInstallTab !== "prompt" ? (
        <OpenClawCliInstallCommand command={activeInstallText} />
      ) : (
        <code translate="no">{activeInstallText}</code>
      )}
    </pre>
  );

  return (
    <article className="skill-install-command-card" aria-labelledby={headingId}>
      <div className="skill-install-command-header">
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
          {desktopInstall ? (
            <button
              type="button"
              className={`skill-install-tab${activeInstallTab === "desktop" ? " is-active" : ""}`}
              aria-pressed={activeInstallTab === "desktop"}
              onClick={() => selectInstallTab("desktop")}
            >
              Desktop
            </button>
          ) : null}
          {!desktopInstall && secondaryInstall ? (
            <button
              type="button"
              className={`skill-install-tab${activeInstallTab === "skills" ? " is-active" : ""}`}
              aria-pressed={activeInstallTab === "skills"}
              onClick={() => selectInstallTab("skills")}
            >
              {secondaryInstall.label}
            </button>
          ) : null}
          {!desktopInstall ? (
            <button
              type="button"
              className={`skill-install-tab${activeInstallTab === "prompt" ? " is-active" : ""}`}
              aria-pressed={activeInstallTab === "prompt"}
              onClick={() => selectInstallTab("prompt")}
            >
              Prompt
            </button>
          ) : null}
        </div>
      </div>

      {activeInstallTab === "desktop" && desktopInstall ? (
        <div className="skill-install-desktop-panel">
          <OpenClawInstall {...desktopInstall} />
        </div>
      ) : (
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
            {activeInstallTab === "prompt" ? (
              commandPreview
            ) : (
              <TooltipProvider delayDuration={180}>
                <Tooltip>
                  <TooltipTrigger asChild>{commandPreview}</TooltipTrigger>
                  <TooltipContent className="skill-install-command-tooltip" side="top" align="end">
                    <code translate="no">{activeInstallText}</code>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {copyEnabled ? (
              <InstallCopyButton
                analyticsMethod={activeInstallTab === "desktop" ? "cli" : activeInstallTab}
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
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}
