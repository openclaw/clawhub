#!/usr/bin/env node
import { Command } from "commander";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { GlobalOpts } from "./cli/types.js";
import { getCliBuildLabel, getCliVersion } from "./cli/buildInfo.js";
import { resolveClawdbotDefaultWorkspace } from "./cli/clawdbotConfig.js";
import { cmdLoginFlow, cmdLogout, cmdWhoami } from "./cli/commands/auth.js";
import {
  cmdDeleteSkill,
  cmdHideSkill,
  cmdUndeleteSkill,
  cmdUnhideSkill,
} from "./cli/commands/delete.js";
import { cmdInspect } from "./cli/commands/inspect.js";
import { cmdBanUser, cmdSetRole } from "./cli/commands/moderation.js";
import { cmdPublish } from "./cli/commands/publish.js";
import {
  cmdExplore,
  cmdInstall,
  cmdList,
  cmdSearch,
  cmdUninstall,
  cmdUpdate,
} from "./cli/commands/skills.js";
import { cmdStarSkill } from "./cli/commands/star.js";
import { cmdSync } from "./cli/commands/sync.js";
import { cmdUnstarSkill } from "./cli/commands/unstar.js";
import { configureCommanderHelp, styleEnvBlock, styleTitle } from "./cli/helpStyle.js";
import { DEFAULT_REGISTRY, DEFAULT_SITE } from "./cli/registry.js";
import { fail } from "./cli/ui.js";
import { readGlobalConfig } from "./config.js";

const program = new Command()
  .name("clawhub")
  .description(
    `${styleTitle(`ClawHub CLI ${getCliBuildLabel()}`)}\n${styleEnvBlock(
      "install, update, search, and publish agent skills.",
    )}`,
  )
  .version(getCliVersion(), "-V, --cli-version", "Show CLI version")
  .option("--workdir <dir>", "Working directory (default: cwd)")
  .option("--dir <dir>", "Skills directory (relative to workdir, default: skills)")
  .option("--site <url>", "Site base URL (for browser login)")
  .option("--registry <url>", "Registry API base URL")
  .option("--no-input", "Disable prompts")
  .showHelpAfterError()
  .showSuggestionAfterError()
  .addHelpText(
    "after",
    styleEnvBlock(
      "\nEnv:\n  CLAWHUB_SITE\n  CLAWHUB_REGISTRY\n  CLAWHUB_WORKDIR\n  (CLAWDHUB_* supported)\n",
    ),
  );

configureCommanderHelp(program);

async function resolveGlobalOpts(): Promise<GlobalOpts> {
  const raw = program.opts<{ workdir?: string; dir?: string; site?: string; registry?: string }>();
  const workdir = await resolveWorkdir(raw.workdir);
  const dir = resolve(workdir, raw.dir ?? "skills");
  const site = raw.site ?? process.env.CLAWHUB_SITE ?? process.env.CLAWDHUB_SITE ?? DEFAULT_SITE;
  const registrySource = raw.registry
    ? "cli"
    : process.env.CLAWHUB_REGISTRY || process.env.CLAWDHUB_REGISTRY
      ? "env"
      : "default";
  const registry =
    raw.registry ??
    process.env.CLAWHUB_REGISTRY ??
    process.env.CLAWDHUB_REGISTRY ??
    DEFAULT_REGISTRY;
  return { workdir, dir, site, registry, registrySource };
}

function isInputAllowed() {
  const globalFlags = program.opts<{ input?: boolean }>();
  return globalFlags.input !== false;
}

async function resolveWorkdir(explicit?: string) {
  if (explicit?.trim()) return resolve(explicit.trim());
  const envWorkdir = process.env.CLAWHUB_WORKDIR?.trim() ?? process.env.CLAWDHUB_WORKDIR?.trim();
  if (envWorkdir) return resolve(envWorkdir);

  const cwd = resolve(process.cwd());
  const hasMarker = await hasClawhubMarker(cwd);
  if (hasMarker) return cwd;

  const clawdbotWorkspace = await resolveClawdbotDefaultWorkspace();
  return clawdbotWorkspace ? resolve(clawdbotWorkspace) : cwd;
}

async function hasClawhubMarker(workdir: string) {
  const lockfile = join(workdir, ".clawhub", "lock.json");
  if (await pathExists(lockfile)) return true;
  const markerDir = join(workdir, ".clawhub");
  if (await pathExists(markerDir)) return true;
  const legacyLockfile = join(workdir, ".clawdhub", "lock.json");
  if (await pathExists(legacyLockfile)) return true;
  const legacyMarkerDir = join(workdir, ".clawdhub");
  return pathExists(legacyMarkerDir);
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

program
  .command("login")
  .description("Log in (opens browser or stores token)")
  .option("--token <token>", "API token")
  .option("--label <label>", "Token label (browser flow only)", "CLI token")
  .option("--no-browser", "Do not open browser (requires --token)")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdLoginFlow(opts, options, isInputAllowed());
  });

program
  .command("logout")
  .description("Remove stored token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdLogout(opts);
  });

program
  .command("whoami")
  .description("Validate token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdWhoami(opts);
  });

const auth = program
  .command("auth")
  .description("Authentication commands")
  .showHelpAfterError()
  .showSuggestionAfterError();

auth
  .command("login")
  .description("Log in (opens browser or stores token)")
  .option("--token <token>", "API token")
  .option("--label <label>", "Token label (browser flow only)", "CLI token")
  .option("--no-browser", "Do not open browser (requires --token)")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdLoginFlow(opts, options, isInputAllowed());
  });

auth
  .command("logout")
  .description("Remove stored token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdLogout(opts);
  });

auth
  .command("whoami")
  .description("Validate token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdWhoami(opts);
  });

program
  .command("search")
  .description("Vector search skills")
  .argument("<query...>", "Query string")
  .option("--limit <n>", "Max results", (value) => Number.parseInt(value, 10))
  .action(async (queryParts, options) => {
    const opts = await resolveGlobalOpts();
    const query = queryParts.join(" ").trim();
    await cmdSearch(opts, query, options.limit);
  });

program
  .command("install")
  .description("Install into <dir>/<slug>")
  .argument("<slug>", "Skill slug")
  .option("--version <version>", "Version to install")
  .option("--force", "Overwrite existing folder")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdInstall(opts, slug, options.version, options.force);
  });

program
  .command("update")
  .description("Update installed skills")
  .argument("[slug]", "Skill slug")
  .option("--all", "Update all installed skills")
  .option("--version <version>", "Update to specific version (single slug only)")
  .option("--force", "Overwrite when local files do not match any version")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUpdate(opts, slug, options, isInputAllowed());
  });

program
  .command("uninstall")
  .description("Uninstall a skill")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUninstall(opts, slug, options, isInputAllowed());
  });

program
  .command("list")
  .description("List installed skills (from lockfile)")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdList(opts);
  });

program
  .command("explore")
  .description("Browse latest updated skills from the registry")
  .option(
    "--limit <n>",
    "Number of skills to show (max 200)",
    (value) => Number.parseInt(value, 10),
    25,
  )
  .option(
    "--sort <order>",
    "Sort by newest, downloads, rating, installs, installsAllTime, or trending",
    "newest",
  )
  .option("--json", "Output JSON")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    const limit =
      typeof options.limit === "number" && Number.isFinite(options.limit) ? options.limit : 25;
    await cmdExplore(opts, { limit, sort: options.sort, json: options.json });
  });

program
  .command("inspect")
  .description("Fetch skill metadata and files without installing")
  .argument("<slug>", "Skill slug")
  .option("--version <version>", "Version to inspect")
  .option("--tag <tag>", "Tag to inspect (default: latest)")
  .option("--versions", "List version history (first page)")
  .option("--limit <n>", "Max versions to list (1-200)", (value) => Number.parseInt(value, 10))
  .option("--files", "List files for the selected version")
  .option("--file <path>", "Fetch raw file content (text <= 200KB)")
  .option("--moderation", "Fetch moderation reasons and evidence")
  .option("--json", "Output JSON")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdInspect(opts, slug, options);
  });

program
  .command("publish")
  .description("Publish skill from folder")
  .argument("<path>", "Skill folder path")
  .option("--slug <slug>", "Skill slug")
  .option("--name <name>", "Display name")
  .option("--version <version>", "Version (semver)")
  .option("--fork-of <slug[@version]>", "Mark as a fork of an existing skill")
  .option("--changelog <text>", "Changelog text")
  .option("--tags <tags>", "Comma-separated tags", "latest")
  .action(async (folder, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPublish(opts, folder, options);
  });

program
  .command("delete")
  .description("Soft-delete a skill (moderator/admin only)")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdDeleteSkill(opts, slug, options, isInputAllowed());
  });

program
  .command("hide")
  .description("Hide a skill (moderator/admin only)")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdHideSkill(opts, slug, options, isInputAllowed());
  });

program
  .command("undelete")
  .description("Restore a hidden skill (moderator/admin only)")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUndeleteSkill(opts, slug, options, isInputAllowed());
  });

program
  .command("unhide")
  .description("Unhide a skill (moderator/admin only)")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUnhideSkill(opts, slug, options, isInputAllowed());
  });

program
  .command("ban-user")
  .description("Ban a user and delete owned skills (moderator/admin only)")
  .argument("<handleOrId>", "User handle (default) or user id")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search (admin only)")
  .option("--reason <reason>", "Ban reason (optional)")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdBanUser(opts, handleOrId, options, isInputAllowed());
  });

program
  .command("set-role")
  .description("Change a user role (admin only)")
  .argument("<handleOrId>", "User handle (default) or user id")
  .argument("<role>", "user | moderator | admin")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search (admin only)")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, role, options) => {
    const opts = await resolveGlobalOpts();
    await cmdSetRole(opts, handleOrId, role, options, isInputAllowed());
  });

program
  .command("star")
  .description("Add a skill to your highlights")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdStarSkill(opts, slug, options, isInputAllowed());
  });

program
  .command("unstar")
  .description("Remove a skill from your highlights")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUnstarSkill(opts, slug, options, isInputAllowed());
  });

program
  .command("sync")
  .description("Scan local skills and publish new/updated ones")
  .option("--root <dir...>", "Extra scan roots (one or more)")
  .option("--all", "Upload all new/updated skills without prompting")
  .option("--dry-run", "Show what would be uploaded")
  .option("--bump <type>", "Version bump for updates (patch|minor|major)", "patch")
  .option("--changelog <text>", "Changelog to use for updates (non-interactive)")
  .option("--tags <tags>", "Comma-separated tags", "latest")
  .option("--concurrency <n>", "Concurrent registry checks (default: 4)", "4")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    const bump = String(options.bump ?? "patch") as "patch" | "minor" | "major";
    if (!["patch", "minor", "major"].includes(bump)) fail("--bump must be patch|minor|major");
    const concurrencyRaw = Number(options.concurrency ?? 4);
    const concurrency = Number.isFinite(concurrencyRaw) ? Math.round(concurrencyRaw) : 4;
    if (concurrency < 1 || concurrency > 32) fail("--concurrency must be between 1 and 32");
    await cmdSync(
      opts,
      {
        root: options.root,
        all: options.all,
        dryRun: options.dryRun,
        bump,
        changelog: options.changelog,
        tags: options.tags,
        concurrency,
      },
      isInputAllowed(),
    );
  });

program.action(async () => {
  const opts = await resolveGlobalOpts();
  const cfg = await readGlobalConfig();
  if (cfg?.token) {
    await cmdSync(opts, {}, isInputAllowed());
    return;
  }
  program.outputHelp();
  process.exitCode = 0;
});

void program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
