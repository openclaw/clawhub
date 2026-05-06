#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { resolveClawdbotDefaultWorkspace } from "../../clawhub/src/cli/clawdbotConfig.js";
import { cmdLoginFlow, cmdLogout, cmdWhoami } from "../../clawhub/src/cli/commands/auth.js";
import {
  cmdGetPackageTrustedPublisher,
  cmdPackageModerationStatus,
} from "../../clawhub/src/cli/commands/packages.js";
import {
  configureCommanderHelp,
  styleEnvBlock,
  styleTitle,
} from "../../clawhub/src/cli/helpStyle.js";
import { DEFAULT_REGISTRY, DEFAULT_SITE } from "../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../clawhub/src/cli/types.js";
import { fail } from "../../clawhub/src/cli/ui.js";
import { getModeratorCliBuildLabel, getModeratorCliVersion } from "./buildInfo.js";
import { cmdBanUser, cmdSetRole, cmdUnbanUser } from "./commands/moderation.js";
import {
  cmdBackfillPackageArtifacts,
  cmdDeletePackageTrustedPublisher,
  cmdListPackageAppeals,
  cmdListPackageMigrations,
  cmdListPackageReports,
  cmdModeratePackageRelease,
  cmdPackageModerationQueue,
  cmdResolvePackageAppeal,
  cmdSetPackageTrustedPublisher,
  cmdTriagePackageReport,
  cmdUpsertPackageMigration,
} from "./commands/packages.js";

const program = new Command()
  .name("clawhub-mod")
  .description(
    `${styleTitle(`ClawHub Moderator CLI ${getModeratorCliBuildLabel()}`)}\n${styleEnvBlock(
      "platform-only moderation, user administration, and package operations.",
    )}`,
  )
  .version(getModeratorCliVersion(), "-V, --cli-version", "Show CLI version")
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
      "\nEnv:\n  CLAWHUB_SITE\n  CLAWHUB_REGISTRY\n  CLAWHUB_WORKDIR\n  CLAWHUB_MOD_COMMIT\n",
    ),
  );

configureCommanderHelp(program);

async function resolveGlobalOpts(): Promise<GlobalOpts> {
  const raw = program.opts<{
    workdir?: string;
    dir?: string;
    site?: string;
    registry?: string;
  }>();
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
  .option("--label <label>", "Token label (browser flow only)", "Moderator CLI token")
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
  .option("--label <label>", "Token label (browser flow only)", "Moderator CLI token")
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

const users = program
  .command("users")
  .description("Platform user administration")
  .showHelpAfterError()
  .showSuggestionAfterError();

users
  .command("ban")
  .description("Ban a user and delete owned skills")
  .argument("<handleOrId>", "User handle (default) or user id")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search")
  .option("--reason <reason>", "Ban reason")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdBanUser(opts, handleOrId, options, isInputAllowed());
  });

users
  .command("unban")
  .description("Unban a user and restore eligible skills")
  .argument("<handleOrId>", "User handle (default) or user id")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search")
  .option("--reason <reason>", "Unban reason")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUnbanUser(opts, handleOrId, options, isInputAllowed());
  });

users
  .command("set-role")
  .description("Change a user role")
  .argument("<handleOrId>", "User handle (default) or user id")
  .argument("<role>", "user | moderator | admin")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, role, options) => {
    const opts = await resolveGlobalOpts();
    await cmdSetRole(opts, handleOrId, role, options, isInputAllowed());
  });

program
  .command("ban-user")
  .description("Alias for users ban")
  .argument("<handleOrId>", "User handle (default) or user id")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search")
  .option("--reason <reason>", "Ban reason")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdBanUser(opts, handleOrId, options, isInputAllowed());
  });

program
  .command("unban-user")
  .description("Alias for users unban")
  .argument("<handleOrId>", "User handle (default) or user id")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search")
  .option("--reason <reason>", "Unban reason")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUnbanUser(opts, handleOrId, options, isInputAllowed());
  });

program
  .command("set-role")
  .description("Alias for users set-role")
  .argument("<handleOrId>", "User handle (default) or user id")
  .argument("<role>", "user | moderator | admin")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search")
  .option("--yes", "Skip confirmation")
  .action(async (handleOrId, role, options) => {
    const opts = await resolveGlobalOpts();
    await cmdSetRole(opts, handleOrId, role, options, isInputAllowed());
  });

const packages = program
  .command("packages")
  .alias("package")
  .description("Platform package moderation and operations")
  .showHelpAfterError()
  .showSuggestionAfterError();

packages
  .command("moderate")
  .description("Set package release moderation state")
  .argument("<name>", "Package name")
  .requiredOption("--version <version>", "Package version")
  .requiredOption("--state <state>", "approved|quarantined|revoked")
  .requiredOption("--reason <text>", "Moderation note/reason")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdModeratePackageRelease(opts, name, options);
  });

packages
  .command("moderation-status")
  .description("Show package moderation status")
  .argument("<name>", "Package name")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdPackageModerationStatus(opts, name, options);
  });

packages
  .command("moderation-queue")
  .description("List package releases that need moderation")
  .option("--status <status>", "open|blocked|manual|all", "open")
  .option("--cursor <cursor>", "Resume cursor")
  .option("--limit <n>", "Number of releases to show (max 100)", (value) =>
    Number.parseInt(value, 10),
  )
  .option("--json", "Output JSON")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdPackageModerationQueue(opts, options);
  });

packages
  .command("appeals")
  .description("List package appeals for moderator review")
  .option("--status <status>", "open|accepted|rejected|all", "open")
  .option("--cursor <cursor>", "Resume cursor")
  .option("--limit <n>", "Number of appeals to show (max 100)", (value) =>
    Number.parseInt(value, 10),
  )
  .option("--json", "Output JSON")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdListPackageAppeals(opts, options);
  });

packages
  .command("resolve-appeal")
  .description("Resolve or reopen a package appeal")
  .argument("<appeal-id>", "Package appeal id")
  .requiredOption("--status <status>", "open|accepted|rejected")
  .option("--note <text>", "Resolution note; required unless reopening")
  .option("--action <action>", "Final action: none|approve")
  .option("--yes", "Skip confirmation for artifact availability changes")
  .option("--json", "Output JSON")
  .action(async (appealId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdResolvePackageAppeal(opts, appealId, options);
  });

packages
  .command("reports")
  .description("List package reports for moderator review")
  .option("--status <status>", "open|confirmed|dismissed|all", "open")
  .option("--cursor <cursor>", "Resume cursor")
  .option("--limit <n>", "Number of reports to show (max 100)", (value) =>
    Number.parseInt(value, 10),
  )
  .option("--json", "Output JSON")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdListPackageReports(opts, options);
  });

packages
  .command("triage-report")
  .description("Resolve or reopen a package report")
  .argument("<report-id>", "Package report id")
  .requiredOption("--status <status>", "open|confirmed|dismissed")
  .option("--note <text>", "Review note; required unless reopening")
  .option("--action <action>", "Final action: none|quarantine|revoke")
  .option("--yes", "Skip confirmation for artifact availability changes")
  .option("--json", "Output JSON")
  .action(async (reportId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdTriagePackageReport(opts, reportId, options);
  });

packages
  .command("backfill-artifacts")
  .description("Backfill missing package artifact-kind metadata")
  .option("--cursor <cursor>", "Resume cursor")
  .option("--batch-size <n>", "Batch size", (value) => Number.parseInt(value, 10))
  .option("--all", "Continue until all pages are processed")
  .option("--apply", "Write changes; defaults to dry-run")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdBackfillPackageArtifacts(opts, options);
  });

packages
  .command("migrations")
  .description("List official plugin migration rows")
  .option(
    "--phase <phase>",
    "planned|published|clawpack-ready|legacy-zip-only|metadata-ready|blocked|ready-for-openclaw|all",
    "all",
  )
  .option("--cursor <cursor>", "Resume cursor")
  .option("--limit <n>", "Number of migrations to show (max 100)", (value) =>
    Number.parseInt(value, 10),
  )
  .option("--json", "Output JSON")
  .action(async (options) => {
    const opts = await resolveGlobalOpts();
    await cmdListPackageMigrations(opts, options);
  });

packages
  .command("set-migration")
  .description("Create or update an official plugin migration row")
  .argument("<bundled-plugin-id>", "Bundled OpenClaw plugin id")
  .requiredOption("--package <name>", "ClawHub package name")
  .option("--owner <owner>", "Migration owner")
  .option("--source-repo <repo>", "Source repository")
  .option("--source-path <path>", "Source path inside repository")
  .option("--source-commit <sha>", "Source commit SHA")
  .option(
    "--phase <phase>",
    "planned|published|clawpack-ready|legacy-zip-only|metadata-ready|blocked|ready-for-openclaw",
  )
  .option("--blockers <items>", "Comma-separated migration blockers")
  .option("--host-targets-complete", "Mark host target metadata complete")
  .option("--scan-clean", "Mark scan state clean")
  .option("--moderation-approved", "Mark moderation approved")
  .option("--runtime-bundles-ready", "Mark runtime bundles ready")
  .option("--notes <text>", "Operator notes")
  .option("--json", "Output JSON")
  .action(async (bundledPluginId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdUpsertPackageMigration(opts, bundledPluginId, options);
  });

const trustedPublisher = packages
  .command("trusted-publisher")
  .description("Manage package trusted publisher config")
  .showHelpAfterError()
  .showSuggestionAfterError();

trustedPublisher
  .command("get")
  .description("Show trusted publisher config for a package")
  .argument("<name>", "Package name")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdGetPackageTrustedPublisher(opts, name, options);
  });

trustedPublisher
  .command("set")
  .description("Attach or replace trusted publisher config for a package")
  .argument("<name>", "Package name")
  .requiredOption("--repository <repo>", "GitHub repo (owner/repo or URL)")
  .requiredOption("--workflow-filename <file>", "Workflow filename, for example publish.yml")
  .option("--environment <name>", "Optional GitHub environment name to pin")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdSetPackageTrustedPublisher(opts, name, options);
  });

trustedPublisher
  .command("delete")
  .description("Remove trusted publisher config from a package")
  .argument("<name>", "Package name")
  .option("--json", "Output JSON")
  .action(async (name, options) => {
    const opts = await resolveGlobalOpts();
    await cmdDeletePackageTrustedPublisher(opts, name, options);
  });

program.action(() => {
  program.outputHelp();
  process.exitCode = 0;
});

void program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
