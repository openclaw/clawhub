#!/usr/bin/env node
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { resolveClawdbotDefaultWorkspace } from "../../clawhub/src/cli/clawdbotConfig.js";
import { cmdLoginFlow, cmdLogout, cmdWhoami } from "../../clawhub/src/cli/commands/auth.js";
import { cmdUnhideSkill } from "../../clawhub/src/cli/commands/delete.js";
import {
  cmdGetPackageTrustedPublisher,
  cmdPackageModerationStatus,
} from "../../clawhub/src/cli/commands/packages.js";
import {
  cmdListSkillReports,
  cmdTriageSkillReport,
} from "../../clawhub/src/cli/commands/skills.js";
import {
  configureCommanderHelp,
  styleEnvBlock,
  styleTitle,
} from "../../clawhub/src/cli/helpStyle.js";
import { DEFAULT_REGISTRY, DEFAULT_SITE } from "../../clawhub/src/cli/registry.js";
import type { GlobalOpts } from "../../clawhub/src/cli/types.js";
import { fail } from "../../clawhub/src/cli/ui.js";
import { getAdminCliBuildLabel, getAdminCliVersion } from "./buildInfo.js";
import {
  cmdGetContentRightsCase,
  cmdRecordContentRightsCorrespondence,
} from "./commands/contentRights.js";
import { cmdSendStaffEmail } from "./commands/email.js";
import {
  cmdBanUser,
  cmdRecoverPersonalPublisher,
  cmdReclassifyBan,
  cmdRepairVtPendingSkills,
  cmdRescanAllSkills,
  cmdRescanSkill,
  cmdSetRole,
  cmdUnbanUser,
} from "./commands/moderation.js";
import {
  cmdAddOfficialOrg,
  cmdCreateOrg,
  cmdDeleteOrg,
  cmdListOfficialOrgs,
  cmdRemoveOfficialOrg,
  cmdRemoveOrgMember,
  cmdRepairScopedPackages,
} from "./commands/orgs.js";
import {
  cmdDeletePackageTrustedPublisher,
  cmdListPackageMigrations,
  cmdListPackageReports,
  cmdModeratePackageRelease,
  cmdPackageModerationQueue,
  cmdRepairPackageName,
  cmdRepairPackageRuntimeId,
  cmdSetPackageTrustedPublisher,
  cmdTriagePackageReport,
  cmdTransferPackageOwner,
  cmdUpsertPackageMigration,
} from "./commands/packages.js";

const program = new Command()
  .name("clawhub-admin")
  .description(
    `${styleTitle(`ClawHub Admin CLI ${getAdminCliBuildLabel()}`)}\n${styleEnvBlock(
      "platform-only moderation, user administration, and package operations.",
    )}`,
  )
  .version(getAdminCliVersion(), "-V, --cli-version", "Show CLI version")
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
      "\nEnv:\n  CLAWHUB_SITE\n  CLAWHUB_REGISTRY\n  CLAWHUB_WORKDIR\n  CLAWHUB_ADMIN_COMMIT\n",
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
  .option("--label <label>", "Token label (browser flow only)", "Admin CLI token")
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
  .option("--label <label>", "Token label (browser flow only)", "Admin CLI token")
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

users
  .command("reclassify-ban")
  .description("Change the stored reason for an existing ban")
  .argument("<handleOrId>", "User handle (default) or user id")
  .option("--apply", "Write changes; defaults to dry-run")
  .option("--dry-run", "Plan only (default)")
  .option("--id", "Treat argument as user id")
  .option("--fuzzy", "Resolve handle via fuzzy user search")
  .requiredOption("--reason <reason>", "New ban reason")
  .option("--yes", "Skip confirmation for --apply")
  .option("--json", "Output JSON")
  .action(async (handleOrId, options) => {
    const opts = await resolveGlobalOpts();
    await cmdReclassifyBan(opts, handleOrId, options, isInputAllowed());
  });

users
  .command("recover-publisher")
  .description("Recover a personal publisher for a verified current GitHub account")
  .argument("<handle>", "Personal publisher handle to recover")
  .requiredOption("--to <handle>", "Destination current ClawHub user handle")
  .requiredOption("--previous-github-id <id>", "Previous immutable GitHub provider account id")
  .requiredOption("--next-github-id <id>", "Next immutable GitHub provider account id")
  .requiredOption("--reason <reason>", "Audit reason")
  .option("--retired-handle <handle>", "Handle for retiring the previous ClawHub user")
  .option("--verified", "Confirm staff verified continuity between both GitHub principals")
  .option("--apply", "Write changes; defaults to dry-run")
  .option("--yes", "Skip confirmation for --apply")
  .option("--json", "Output JSON")
  .action(async (handle, options) => {
    const opts = await resolveGlobalOpts();
    await cmdRecoverPersonalPublisher(opts, handle, options, isInputAllowed());
  });

const plugins = program
  .command("plugins")
  .alias("plugin")
  .description("Plugin moderation and operations")
  .showHelpAfterError()
  .showSuggestionAfterError();

const packages = program
  .command("packages")
  .alias("package")
  .description("Package moderation and operations")
  .showHelpAfterError()
  .showSuggestionAfterError();

const org = program
  .command("org")
  .description("Org publisher administration")
  .showHelpAfterError()
  .showSuggestionAfterError();

const publisher = program
  .command("publisher")
  .alias("publishers")
  .description("Publisher administration")
  .showHelpAfterError()
  .showSuggestionAfterError();

const email = program
  .command("email")
  .description("Guarded staff email operations")
  .showHelpAfterError()
  .showSuggestionAfterError();

const contentRights = program
  .command("content-rights")
  .description("ClawHub content rights case operations")
  .showHelpAfterError()
  .showSuggestionAfterError();

const skills = program
  .command("skills")
  .alias("skill")
  .description("Skill artifact moderation")
  .showHelpAfterError()
  .showSuggestionAfterError();

registerPluginOperations(plugins);
registerPluginModerationCommands(plugins);
registerPluginGovernanceCommands(plugins);
registerPluginOperations(packages);
registerPluginModerationCommands(packages);
registerPluginGovernanceCommands(packages);
registerOfficialPublisherCommands(publisher);
registerOrgCommands(org);
registerEmailCommands(email);
registerContentRightsCommands(contentRights);
registerSkillModerationCommands(skills);

function collectOption(value: string, previous: string[]) {
  return [...previous, value];
}

function registerContentRightsCommands(command: Command) {
  command
    .command("get")
    .description("Get an existing ClawHub content rights case from Hermit")
    .argument("<caseId>", "Existing CHR-... case id")
    .option("--json", "Output JSON")
    .action(async (caseId, options) => {
      const opts = await resolveGlobalOpts();
      await cmdGetContentRightsCase(opts, caseId, options);
    });

  command
    .command("record-correspondence")
    .description("Append exact correspondence and evidence to an existing Hermit case")
    .argument("<caseId>", "Existing CHR-... case id")
    .requiredOption("--direction <direction>", "inbound or outbound")
    .requiredOption("--to <email>", "Correspondence recipient")
    .requiredOption("--from <sender>", "Correspondence sender")
    .requiredOption("--subject <subject>", "Exact correspondence subject")
    .requiredOption("--body-file <path>", "Exact plain text correspondence body")
    .option("--provider-message-id <id>", "Email provider message id")
    .option("--attachment <path>", "Evidence attachment to preserve", collectOption, [])
    .option("--json", "Output JSON")
    .action(async (caseId, options) => {
      const opts = await resolveGlobalOpts();
      await cmdRecordContentRightsCorrespondence(opts, caseId, options);
    });
}

function registerEmailCommands(command: Command) {
  command
    .command("send")
    .description("Send a staff email from ClawHub noreply after explicit user sign-off")
    .option("--to <email>", "Recipient email address")
    .option("--user <handle>", "Recipient ClawHub user handle; server resolves their email")
    .option("--username <handle>", "Recipient username for lookup or direct-email metadata")
    .option("--recipient-handle <handle>", "Direct-email recipient metadata handle")
    .requiredOption("--subject <subject>", "Email subject")
    .option("--title <title>", "Visible heading in the generic ClawHub email template")
    .option("--body-file <path>", "Plain text email body file")
    .option("--body <text>", "Plain text email body")
    .option("--action-label <label>", "Optional primary action button label")
    .option("--action-url <url>", "Optional primary action button URL")
    .option("--button-text <text>", "Alias for --action-label")
    .option("--button-link <url>", "Alias for --action-url")
    .option("--send", "Actually send; defaults to dry-run preview")
    .option("--confirm-user-request", "Confirm the user explicitly asked for this email")
    .option(
      "--confirm-user-signoff",
      "Confirm the user approved the final recipient, subject, and body",
    )
    .option("--json", "Output JSON")
    .action(async (options) => {
      const opts = await resolveGlobalOpts();
      await cmdSendStaffEmail(opts, options);
    });
}

function registerOfficialPublisherCommands(command: Command) {
  const official = command
    .command("official")
    .description("Manage official publishers")
    .showHelpAfterError()
    .showSuggestionAfterError();

  official
    .command("list")
    .description("List official publishers")
    .option("--json", "Output JSON")
    .action(async (options) => {
      const opts = await resolveGlobalOpts();
      await cmdListOfficialOrgs(opts, options);
    });

  official
    .command("add")
    .description("Mark a publisher as official")
    .argument("<handle>", "Publisher handle")
    .requiredOption("--reason <reason>", "Audit reason")
    .option("--yes", "Skip confirmation")
    .option("--json", "Output JSON")
    .action(async (handle, options) => {
      const opts = await resolveGlobalOpts();
      await cmdAddOfficialOrg(opts, handle, options, isInputAllowed());
    });

  official
    .command("remove")
    .description("Remove a publisher from the official list")
    .argument("<handle>", "Publisher handle")
    .requiredOption("--reason <reason>", "Audit reason")
    .option("--yes", "Skip confirmation")
    .option("--json", "Output JSON")
    .action(async (handle, options) => {
      const opts = await resolveGlobalOpts();
      await cmdRemoveOfficialOrg(opts, handle, options, isInputAllowed());
    });
}

function registerOrgCommands(command: Command) {
  registerOfficialPublisherCommands(command);

  command
    .command("create")
    .description("Create or update an org publisher")
    .argument("<handle>", "Org publisher handle")
    .option("--display-name <name>", "Display name")
    .option("--member <handle>", "User handle to add to the org")
    .option("--role <role>", "owner|admin|publisher for --member", "owner")
    .option("--trusted", "Mark org as trusted")
    .option("--json", "Output JSON")
    .action(async (handle, options) => {
      const opts = await resolveGlobalOpts();
      await cmdCreateOrg(opts, handle, options);
    });

  command
    .command("remove-member")
    .description("Remove a user from an org publisher")
    .argument("<handle>", "Org publisher handle")
    .argument("<member>", "User handle to remove")
    .option("--json", "Output JSON")
    .action(async (handle, member, options) => {
      const opts = await resolveGlobalOpts();
      await cmdRemoveOrgMember(opts, handle, member, options);
    });

  command
    .command("delete")
    .description("Soft-delete an empty org publisher; defaults to dry-run")
    .argument("<handle>", "Org publisher handle")
    .requiredOption("--reason <reason>", "Audit reason")
    .option("--apply", "Write changes; defaults to dry-run")
    .option("--json", "Output JSON")
    .action(async (handle, options) => {
      const opts = await resolveGlobalOpts();
      await cmdDeleteOrg(opts, handle, options);
    });

  command
    .command("repair-scoped-packages")
    .description("Batch-create org publishers and transfer scoped packages from a CSV")
    .argument("<csv>", "CSV with packageName,intendedOrg,legacyOwner[,orgDisplayName]")
    .option("--apply", "Write changes; defaults to dry-run")
    .option("--start <n>", "Start at zero-based CSV row offset", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--limit <n>", "Limit rows processed", (value) => Number.parseInt(value, 10))
    .option("--reason <reason>", "Override audit reason for all rows")
    .option("--result-file <path>", "Write JSON result report")
    .option("--json", "Output JSON")
    .action(async (csv, options) => {
      const opts = await resolveGlobalOpts();
      await cmdRepairScopedPackages(opts, csv, options);
    });
}

function registerPluginGovernanceCommands(command: Command) {
  command
    .command("transfer")
    .description("Transfer a plugin package to another publisher without changing package stats")
    .argument("<name>", "Plugin package name")
    .requiredOption("--to <owner>", "Destination publisher handle")
    .requiredOption("--reason <reason>", "Audit reason")
    .option("--apply", "Write changes; defaults to dry-run")
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      const opts = await resolveGlobalOpts();
      await cmdTransferPackageOwner(opts, name, options);
    });

  command
    .command("repair-name")
    .description("Admin repair for plugin package names")
    .argument("<name>", "Current plugin package name")
    .requiredOption("--next-name <name>", "Target plugin package name")
    .option("--retire-target", "Rename and soft-delete the current target package first")
    .option("--owner <handle>", "Transfer repaired package to a publisher handle")
    .requiredOption("--reason <reason>", "Audit reason")
    .option("--apply", "Write changes; defaults to dry-run")
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      const opts = await resolveGlobalOpts();
      await cmdRepairPackageName(opts, name, options);
    });

  command
    .command("repair-runtime-id")
    .description("Admin repair for plugin package runtime ids")
    .argument("<name>", "Current plugin package name")
    .requiredOption("--next-runtime-id <id>", "Target plugin runtime id")
    .requiredOption("--reason <reason>", "Audit reason")
    .option("--apply", "Write changes; defaults to dry-run")
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      const opts = await resolveGlobalOpts();
      await cmdRepairPackageRuntimeId(opts, name, options);
    });

  command
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

  command
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

  const trustedPublisher = command
    .command("trusted-publisher")
    .description("Manage plugin trusted publisher config")
    .showHelpAfterError()
    .showSuggestionAfterError();

  trustedPublisher
    .command("get")
    .description("Show trusted publisher config for a plugin package")
    .argument("<name>", "Plugin package name")
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      const opts = await resolveGlobalOpts();
      await cmdGetPackageTrustedPublisher(opts, name, options);
    });

  trustedPublisher
    .command("set")
    .description("Attach or replace trusted publisher config for a plugin package")
    .argument("<name>", "Plugin package name")
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
    .description("Remove trusted publisher config from a plugin package")
    .argument("<name>", "Plugin package name")
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      const opts = await resolveGlobalOpts();
      await cmdDeletePackageTrustedPublisher(opts, name, options);
    });
}

function registerPluginModerationCommands(command: Command) {
  command
    .command("reports")
    .description("List plugin reports for moderator review")
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

  command
    .command("triage-report")
    .description("Resolve or reopen a plugin report")
    .argument("<report-id>", "Plugin report id")
    .requiredOption("--status <status>", "open|confirmed|dismissed")
    .option("--note <text>", "Review note; required unless reopening")
    .option("--action <action>", "Final action: none|quarantine|revoke")
    .option("--yes", "Skip confirmation for artifact availability changes")
    .option("--json", "Output JSON")
    .action(async (reportId, options) => {
      const opts = await resolveGlobalOpts();
      await cmdTriagePackageReport(opts, reportId, options);
    });
}

function registerPluginOperations(command: Command) {
  command
    .command("moderate")
    .description("Set plugin release moderation state")
    .argument("<name>", "Plugin package name")
    .requiredOption("--version <version>", "Plugin package version")
    .requiredOption("--state <state>", "approved|quarantined|revoked")
    .requiredOption("--reason <text>", "Moderation note/reason")
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      const opts = await resolveGlobalOpts();
      await cmdModeratePackageRelease(opts, name, options);
    });

  command
    .command("status")
    .alias("moderation-status")
    .description("Show plugin moderation status")
    .argument("<name>", "Plugin package name")
    .option("--json", "Output JSON")
    .action(async (name, options) => {
      const opts = await resolveGlobalOpts();
      await cmdPackageModerationStatus(opts, name, options);
    });

  command
    .command("queue")
    .alias("moderation-queue")
    .description("List plugin releases that need moderation")
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
}

function registerSkillModerationCommands(command: Command) {
  command
    .command("unhide")
    .description("Manually restore a hidden skill after moderator review")
    .argument("<slug>", "Skill slug")
    .option("--reason <text>", "Audit reason")
    .option("--note <text>", "Alias for --reason")
    .option("--yes", "Skip confirmation")
    .action(async (slug, options) => {
      if (
        options.reason?.trim() &&
        options.note?.trim() &&
        options.reason.trim() !== options.note.trim()
      ) {
        fail("Pass only one of --reason or --note");
      }
      if (!options.reason?.trim() && !options.note?.trim()) {
        fail("--reason required");
      }
      const opts = await resolveGlobalOpts();
      await cmdUnhideSkill(opts, slug, options, isInputAllowed());
    });

  command
    .command("rescan")
    .description("Queue a moderator ClawScan rescan for a skill")
    .argument("<slug>", "Skill slug")
    .option("--version <version>", "Specific skill version; defaults to latest")
    .option("--yes", "Skip confirmation")
    .option("--json", "Output JSON")
    .action(async (slug, options) => {
      const opts = await resolveGlobalOpts();
      await cmdRescanSkill(opts, slug, options, isInputAllowed());
    });

  command
    .command("rescan-all")
    .description("Queue admin ClawScan rescans for active latest skills in paced batches")
    .option("--batch-size <n>", "Batch size; backend caps at 100", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--poll-interval <sec>", "Seconds between batch status polls", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--cursor <cursor>", "Resume from a backend pagination cursor")
    .option("--max-skills <n>", "Stop after this many scanned/queued/skipped skills", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--dry-run", "Page eligible skills without queueing jobs")
    .option("--yes", "Skip confirmation")
    .option("--json", "Output JSON progress events")
    .option("--fail-fast", "Stop after the first drained batch with failed jobs")
    .action(async (options) => {
      const opts = await resolveGlobalOpts();
      await cmdRescanAllSkills(opts, options, isInputAllowed());
    });

  command
    .command("repair-vt-pending")
    .description("Repair stale pending VirusTotal skill cache by rechecking hashes")
    .option("--batch-size <n>", "Batch size; backend caps at 500", (value) =>
      Number.parseInt(value, 10),
    )
    .option(
      "--concurrency <n>",
      "Per-batch VirusTotal lookup concurrency; backend caps at 32",
      (value) => Number.parseInt(value, 10),
    )
    .option("--cursor <cursor>", "Resume from a backend pagination cursor")
    .option("--dry-run", "Check pending rows without writing VT cache updates")
    .option("--all", "Continue paging until the backend reports done")
    .option("--yes", "Skip confirmation for write runs")
    .option("--json", "Output JSON progress events")
    .action(async (options) => {
      const opts = await resolveGlobalOpts();
      await cmdRepairVtPendingSkills(opts, options, isInputAllowed());
    });

  command
    .command("reports")
    .description("List skill reports for moderator review")
    .option("--status <status>", "open|confirmed|dismissed|all", "open")
    .option("--cursor <cursor>", "Resume cursor")
    .option("--limit <n>", "Number of reports to show (max 200)", (value) =>
      Number.parseInt(value, 10),
    )
    .option("--json", "Output JSON")
    .action(async (options) => {
      const opts = await resolveGlobalOpts();
      await cmdListSkillReports(opts, options);
    });

  command
    .command("triage-report")
    .description("Resolve or reopen a skill report")
    .argument("<report-id>", "Skill report id")
    .requiredOption("--status <status>", "open|confirmed|dismissed")
    .option("--note <text>", "Review note; required unless reopening")
    .option("--action <action>", "Final action: none|hide")
    .option("--yes", "Skip confirmation for artifact availability changes")
    .option("--json", "Output JSON")
    .action(async (reportId, options) => {
      const opts = await resolveGlobalOpts();
      await cmdTriageSkillReport(opts, reportId, options);
    });
}

program.action(() => {
  program.outputHelp();
  process.exitCode = 0;
});

void program.parseAsync(process.argv).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
