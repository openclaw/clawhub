#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
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
import { cmdMergeSkill, cmdRenameSkill } from "./cli/commands/ownership.js";
import {
  cmdAppealPackage,
  cmdDeletePackage,
  cmdDownloadPackage,
  cmdExplorePackages,
  cmdGetPackageTrustedPublisher,
  cmdInspectPackage,
  cmdPackageModerationStatus,
  cmdPackageMigrationStatus,
  cmdPackageReadiness,
  cmdPackPackage,
  cmdPublishPackage,
  cmdReportPackage,
  cmdVerifyPackage,
} from "./cli/commands/packages.js";
import { cmdPublish } from "./cli/commands/publish.js";
import { cmdRescanPackage, cmdRescanSkill } from "./cli/commands/rescan.js";
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
import {
  cmdTransferAccept,
  cmdTransferCancel,
  cmdTransferList,
  cmdTransferReject,
  cmdTransferRequest,
} from "./cli/commands/transfer.js";
import { cmdUnstarSkill } from "./cli/commands/unstar.js";
import { configureCommanderHelp, styleEnvBlock, styleTitle } from "./cli/helpStyle.js";
import { DEFAULT_REGISTRY, DEFAULT_SITE } from "./cli/registry.js";
import type { GlobalOpts } from "./cli/types.js";
import { fail } from "./cli/ui.js";
import { readGlobalConfig } from "./config.js";

const program = new Command()
  .name("clawhub")
  .description(
    `${styleTitle(`ClawHub CLI ${getCliBuildLabel()}`)}\n${styleEnvBlock(
      "install, update, search, and publish skills plus OpenClaw packages.",
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

function registerCommand(parent: Command, path: readonly string[]) {
  return parent.command(path.at(-1) ?? "");
}

function registerCommandGroup(parent: Command, path: readonly string[]) {
  return parent.command(path.at(-1) ?? "");
}

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

registerCommand(program, ["login"])
  .description("Log in (opens browser or stores token)")
  .option("--token <token>", "API token")
  .option("--label <label>", "Token label (browser flow only)", "CLI token")
  .option("--no-browser", "Do not open browser (requires --token)")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdLoginFlow(opts, options, isInputAllowed());
  });

registerCommand(program, ["logout"])
  .description("Remove stored token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdLogout(opts);
  });

registerCommand(program, ["whoami"])
  .description("Validate token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdWhoami(opts);
  });

const auth = registerCommandGroup(program, ["auth"])
  .description("Authentication commands")
  .showHelpAfterError()
  .showSuggestionAfterError();

registerCommand(auth, ["auth", "login"])
  .description("Log in (opens browser or stores token)")
  .option("--token <token>", "API token")
  .option("--label <label>", "Token label (browser flow only)", "CLI token")
  .option("--no-browser", "Do not open browser (requires --token)")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdLoginFlow(opts, options, isInputAllowed());
  });

registerCommand(auth, ["auth", "logout"])
  .description("Remove stored token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdLogout(opts);
  });

registerCommand(auth, ["auth", "whoami"])
  .description("Validate token")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdWhoami(opts);
  });

registerCommand(program, ["search"])
  .description("Vector search skills")
  .argument("<query...>", "Query string")
  .option("--limit <n>", "Max results", (value) => Number.parseInt(value, 10))
  .action(async (queryParts, options) => {
    const opts = await resolveGlobalOpts();
    const query = queryParts.join(" ").trim();
    await cmdSearch(opts, query, options.limit);
  });

registerCommand(program, ["install"])
  .description("Install into <dir>/<slug>")
  .argument("<slug>", "Skill slug")
  .option("--version <version>", "Version to install")
  .option("--force", "Overwrite existing folder")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdInstall(opts, slug, options.version, options.force);
  });

registerCommand(program, ["update"])
  .description("Update installed skills")
  .argument("[slug]", "Skill slug")
  .option("--all", "Update all installed skills")
  .option("--version <version>", "Update to specific version (single slug only)")
  .option("--force", "Overwrite when local files do not match any version")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUpdate(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["uninstall"])
  .description("Uninstall a skill")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUninstall(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["list"])
  .description("List installed skills (tracked and manually installed)")
  .action(async () => {
    const opts = await resolveGlobalOpts();
    await cmdList(opts);
  });

registerCommand(program, ["explore"])
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

registerCommand(program, ["inspect"])
  .description("Fetch skill metadata and files without installing")
  .argument("<slug>", "Skill slug")
  .option("--version <version>", "Version to inspect")
  .option("--tag <tag>", "Tag to inspect (default: latest)")
  .option("--versions", "List version history (first page)")
  .option("--limit <n>", "Max versions to list (1-200)", (value) => Number.parseInt(value, 10))
  .option("--files", "List files for the selected version")
  .option("--file <path>", "Fetch raw file content (text <= 200KB)")
  .option("--json", "Output JSON")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdInspect(opts, slug, options);
  });

registerCommand(program, ["publish"])
  .description("Legacy alias: publish a skill from folder")
  .argument("<path>", "Skill folder path")
  .option("--slug <slug>", "Skill slug")
  .option("--name <name>", "Display name")
  .option("--owner <handle>", "Publish under an org/user publisher handle")
  .option("--version <version>", "Version (semver)")
  .option("--fork-of <slug[@version]>", "Mark as a fork of an existing skill")
  .option("--changelog <text>", "Changelog text")
  .option("--tags <tags>", "Comma-separated tags", "latest")
  .action(async (folder, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPublish(opts, folder, options);
  });

registerCommand(program, ["delete"])
  .description("Soft-delete one of your skills")
  .argument("<slug>", "Skill slug")
  .option("--reason <text>", "Moderation note/reason")
  .option("--note <text>", "Alias for --reason")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdDeleteSkill(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["hide"])
  .description("Hide one of your skills")
  .argument("<slug>", "Skill slug")
  .option("--reason <text>", "Moderation note/reason")
  .option("--note <text>", "Alias for --reason")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdHideSkill(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["undelete"])
  .description("Restore one of your hidden skills")
  .argument("<slug>", "Skill slug")
  .option("--reason <text>", "Moderation note/reason")
  .option("--note <text>", "Alias for --reason")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUndeleteSkill(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["unhide"])
  .description("Unhide one of your skills")
  .argument("<slug>", "Skill slug")
  .option("--reason <text>", "Moderation note/reason")
  .option("--note <text>", "Alias for --reason")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUnhideSkill(opts, slug, options, isInputAllowed());
  });

const skill = registerCommandGroup(program, ["skill"]).description("Manage published skills");
registerCommand(skill, ["skill", "publish"])
  .description("Publish a skill from folder")
  .argument("<path>", "Skill folder path")
  .option("--slug <slug>", "Skill slug")
  .option("--name <name>", "Display name")
  .option("--owner <handle>", "Publish under an org/user publisher handle")
  .option("--version <version>", "Version (semver)")
  .option("--fork-of <slug[@version]>", "Mark as a fork of an existing skill")
  .option("--changelog <text>", "Changelog text")
  .option("--tags <tags>", "Comma-separated tags", "latest")
  .action(async (folder, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPublish(opts, folder, options);
  });

const packageCmd = registerCommandGroup(program, ["package"]).description(
  "Browse and publish OpenClaw packages",
);

registerCommand(packageCmd, ["package", "explore"])
  .description("Browse published packages and plugins")
  .argument("[query...]", "Optional search query")
  .option("--family <family>", "skill|code-plugin|bundle-plugin")
  .option("--official", "Only official packages")
  .option("--executes-code", "Only packages that execute code")
  .option("--target <target>", "Filter by host target, e.g. darwin-arm64")
  .option("--os <os>", "Filter by host OS, e.g. darwin, linux, win32")
  .option("--arch <arch>", "Filter by host architecture, e.g. arm64 or x64")
  .option("--libc <libc>", "Filter by libc, e.g. glibc or musl")
  .option("--requires-browser", "Only packages that require a browser")
  .option("--requires-desktop", "Only packages that require local desktop access")
  .option("--requires-native-deps", "Only packages with native dependency requirements")
  .option("--requires-external-service", "Only packages that require an external service")
  .option("--external-service <name>", "Filter by named external service")
  .option("--binary <name>", "Filter by required local binary")
  .option("--os-permission <name>", "Filter by required OS permission")
  .option("--artifact-kind <kind>", "legacy-zip|npm-pack")
  .option("--npm-mirror", "Only packages available through the npm mirror")
  .option(
    "--limit <n>",
    "Number of packages to show (max 100)",
    (value) => Number.parseInt(value, 10),
    25,
  )
  .option("--json", "Output JSON")
  .action(async (queryParts, options) => {
    const opts = await resolveGlobalOpts();
    const query = Array.isArray(queryParts) ? queryParts.join(" ").trim() : "";
    await cmdExplorePackages(opts, query, options);
  });

registerCommand(packageCmd, ["package", "inspect"])
  .description("Fetch package metadata and files without installing")
  .argument("<name>", "Package name")
  .option("--version <version>", "Version to inspect")
  .option("--tag <tag>", "Tag to inspect (default: latest)")
  .option("--versions", "List version history (first page)")
  .option("--limit <n>", "Max versions to list (1-100)", (value) => Number.parseInt(value, 10))
  .option("--files", "List files for the selected version")
  .option("--file <path>", "Fetch raw file content (text only)")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdInspectPackage(opts, name, options);
  });

registerCommand(packageCmd, ["package", "download"])
  .description("Download a package artifact and verify its published digests")
  .argument("<name>", "Package name")
  .option("--version <version>", "Version to download")
  .option("--tag <tag>", "Tag to download (default: latest)")
  .option("-o, --output <path>", "Output file or directory")
  .option("--force", "Overwrite existing output file")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdDownloadPackage(opts, name, options);
  });

registerCommand(packageCmd, ["package", "verify"])
  .description("Verify a local package artifact against ClawHub or expected digests")
  .argument("<file>", "Artifact file")
  .option("--package <name>", "Package name to resolve expected artifact metadata")
  .option("--version <version>", "Package version to resolve")
  .option("--tag <tag>", "Package tag to resolve")
  .option("--sha256 <hex>", "Expected ClawHub SHA-256")
  .option("--npm-integrity <sri>", "Expected npm sha512 integrity")
  .option("--npm-shasum <sha1>", "Expected npm shasum")
  .option("--json", "Output JSON")
  .action(async (file, options) => {
    const opts = await resolveGlobalOpts();
    await cmdVerifyPackage(opts, file, {
      ...options,
      packageName: options.package,
    });
  });

registerCommand(packageCmd, ["package", "delete"])
  .description("Soft-delete a package and all releases")
  .argument("<name>", "Package name")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdDeletePackage(opts, name, options, isInputAllowed());
  });

registerCommand(packageCmd, ["package", "report"])
  .description("Report a package for moderator review")
  .argument("<name>", "Package name")
  .option("--version <version>", "Package version")
  .requiredOption("--reason <text>", "Report reason")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdReportPackage(opts, name, options);
  });

registerCommand(packageCmd, ["package", "appeal"])
  .description("Appeal moderation for a package release")
  .argument("<name>", "Package name")
  .requiredOption("--version <version>", "Package version")
  .requiredOption("--message <text>", "Appeal message")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdAppealPackage(opts, name, options);
  });

registerCommand(packageCmd, ["package", "moderation-status"])
  .description("Show package moderation status")
  .argument("<name>", "Package name")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPackageModerationStatus(opts, name, options);
  });

registerCommand(packageCmd, ["package", "readiness"])
  .description("Check package readiness for future OpenClaw consumption")
  .argument("<name>", "Package name")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPackageReadiness(opts, name, options);
  });

registerCommand(packageCmd, ["package", "migration-status"])
  .description("Show package migration status for future OpenClaw consumption")
  .argument("<name>", "Package name")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPackageMigrationStatus(opts, name, options);
  });

registerCommand(packageCmd, ["package", "pack"])
  .description("Create a ClawPack npm tarball from a plugin package folder")
  .argument("<source>", "Package folder path")
  .option("--pack-destination <dir>", "Directory for the generated .tgz (default: workdir)")
  .option("--json", "Output JSON")
  .action(async (source, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPackPackage(opts, source, options);
  });

registerCommand(packageCmd, ["package", "publish"])
  .description("Publish a code plugin or bundle plugin from a folder or GitHub source")
  .argument("<source>", "Package folder path, GitHub repo (owner/repo[@ref]), or URL")
  .option("--family <family>", "code-plugin|bundle-plugin")
  .option("--name <name>", "Package name")
  .option("--display-name <name>", "Display name")
  .option("--owner <handle>", "Publish under this owner/publisher handle")
  .option("--version <version>", "Version")
  .option("--changelog <text>", "Changelog text")
  .option(
    "--manual-override-reason <reason>",
    "Required for manual publish when trusted publisher config exists",
  )
  .option("--tags <tags>", "Comma-separated tags", "latest")
  .option("--bundle-format <format>", "Bundle format")
  .option("--host-targets <targets>", "Comma-separated bundle host targets")
  .option("--source-repo <repo>", "GitHub repo (owner/repo or URL)")
  .option("--source-commit <sha>", "Git commit SHA")
  .option("--source-ref <ref>", "Git ref/tag/branch")
  .option("--source-path <path>", "Repo subpath")
  .option("--dry-run", "Preview what would be published without uploading")
  .option("--json", "Output JSON (for CI pipelines)")
  .action(async (source, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPublishPackage(opts, source, options);
  });

const trustedPublisherCmd = registerCommandGroup(packageCmd, [
  "package",
  "trusted-publisher",
]).description("Manage package trusted publisher config");

registerCommand(trustedPublisherCmd, ["package", "trusted-publisher", "get"])
  .description("Show trusted publisher config for a package")
  .argument("<name>", "Package name")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdGetPackageTrustedPublisher(opts, name, options);
  });

registerCommand(packageCmd, ["package", "rescan"])
  .description("Request a security rescan for the latest published package release")
  .argument("<name>", "Package name")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdRescanPackage(opts, name, options, isInputAllowed());
  });

registerCommand(skill, ["skill", "rename"])
  .description("Rename a published skill and keep the old slug as a redirect")
  .argument("<slug>", "Current skill slug")
  .argument("<new-slug>", "New canonical slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, newSlug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdRenameSkill(opts, slug, newSlug, options, isInputAllowed());
  });

registerCommand(skill, ["skill", "merge"])
  .description("Merge one owned skill into another and redirect the old slug")
  .argument("<source-slug>", "Source skill slug")
  .argument("<target-slug>", "Target canonical slug")
  .option("--yes", "Skip confirmation")
  .action(async (sourceSlug, targetSlug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdMergeSkill(opts, sourceSlug, targetSlug, options, isInputAllowed());
  });

registerCommand(skill, ["skill", "rescan"])
  .description("Request a security rescan for the latest published skill version")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .option("--json", "Output JSON")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdRescanSkill(opts, slug, options, isInputAllowed());
  });

const transfer = registerCommandGroup(program, ["transfer"]).description(
  "Transfer skill ownership",
);

registerCommand(transfer, ["transfer", "request"])
  .description("Request skill transfer to another user")
  .argument("<slug>", "Skill slug")
  .argument("<handle>", "Recipient handle (e.g., @username)")
  .option("--message <text>", "Optional message for recipient")
  .option("--yes", "Skip confirmation")
  .action(async (slug, handle, options) => {
    const opts = await resolveGlobalOpts();
    await cmdTransferRequest(opts, slug, handle, options, isInputAllowed());
  });

registerCommand(transfer, ["transfer", "list"])
  .description("List pending transfer requests")
  .option("--outgoing", "Show outgoing transfer requests")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdTransferList(opts, options);
  });

registerCommand(transfer, ["transfer", "accept"])
  .description("Accept incoming transfer for a skill")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdTransferAccept(opts, slug, options, isInputAllowed());
  });

registerCommand(transfer, ["transfer", "reject"])
  .description("Reject incoming transfer for a skill")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdTransferReject(opts, slug, options, isInputAllowed());
  });

registerCommand(transfer, ["transfer", "cancel"])
  .description("Cancel outgoing transfer for a skill")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdTransferCancel(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["star"])
  .description("Add a skill to your highlights")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdStarSkill(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["unstar"])
  .description("Remove a skill from your highlights")
  .argument("<slug>", "Skill slug")
  .option("--yes", "Skip confirmation")
  .action(async (slug, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUnstarSkill(opts, slug, options, isInputAllowed());
  });

registerCommand(program, ["sync"])
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
