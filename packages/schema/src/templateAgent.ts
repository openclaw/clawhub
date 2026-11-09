import { type inferred, type } from "arktype";

const CONCRETE_MCP_TOOL_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*__[A-Za-z][A-Za-z0-9_-]*$/;
export const OPENCLAW_TEMPLATE_AGENT_POLICY_V1 = {
  contractVersion: 1,
  source: {
    repository: "openclaw/openclaw",
    commit: "16115153f0d5e7faebb755f3fbccf81437e01b67",
    path: "src/templates/schema.ts",
  },
  profiles: ["minimal", "coding", "messaging", "full"],
} as const;
type OpenClawBuiltinProfile = (typeof OPENCLAW_TEMPLATE_AGENT_POLICY_V1.profiles)[number];
// Frozen from the pinned consumer's src/agents/tool-catalog.ts profile/group exports.
// Dynamic bundle-mcp grants remain excluded; only bounded concrete MCP names are admitted below.
const OPENCLAW_PROFILE_TOOL_ALLOW = {
  minimal: new Set(["presence", "session_status", "gateway"]),
  coding: new Set([
    "decision_evaluate",
    "ls",
    "read",
    "write",
    "edit",
    "apply_patch",
    "exec",
    "process",
    "code_execution",
    "secrets",
    "web_search",
    "web_fetch",
    "x_search",
    "memory_search",
    "memory_get",
    "personal_instructions",
    "presence",
    "sessions",
    "sessions_create",
    "sessions_list",
    "sessions_history",
    "sessions_search",
    "conversations_list",
    "conversations_send",
    "conversations_turn",
    "sessions_send",
    "sessions_spawn",
    "github_identity_status",
    "github_publish",
    "agents_wait",
    "sessions_yield",
    "subagents",
    "session_status",
    "suggest_task",
    "dismiss_task",
    "screen",
    "theme",
    "dashboard",
    "terminal",
    "portal",
    "automations",
    "gateway",
    "plugins",
    "get_goal",
    "create_goal",
    "update_goal",
    "progress_card",
    "ask_user",
    "skill_workshop",
    "skill_library",
    "skills_search",
    "skills_read",
    "view_image",
    "image_generate",
    "music_generate",
    "video_generate",
  ]),
  messaging: new Set([
    "decision_evaluate",
    "secrets",
    "personal_instructions",
    "presence",
    "sessions",
    "sessions_create",
    "sessions_list",
    "sessions_history",
    "sessions_search",
    "conversations_list",
    "conversations_send",
    "conversations_turn",
    "sessions_send",
    "sessions_spawn",
    "sessions_yield",
    "subagents",
    "session_status",
    "theme",
    "message",
    "gateway",
    "ask_user",
  ]),
  full: null,
} as const;
const OPENCLAW_STATIC_TOOL_GROUPS: Record<string, ReadonlySet<string>> = {
  "group:openclaw": new Set([
    "decision_evaluate",
    "code_execution",
    "secrets",
    "web_search",
    "web_fetch",
    "x_search",
    "memory_search",
    "memory_get",
    "personal_instructions",
    "presence",
    "sessions",
    "sessions_create",
    "sessions_list",
    "sessions_history",
    "sessions_search",
    "conversations_list",
    "conversations_send",
    "conversations_turn",
    "sessions_send",
    "sessions_spawn",
    "github_identity_status",
    "github_publish",
    "agents_wait",
    "sessions_yield",
    "subagents",
    "session_status",
    "suggest_task",
    "dismiss_task",
    "browser",
    "screen",
    "theme",
    "dashboard",
    "terminal",
    "portal",
    "show_widget",
    "message",
    "automations",
    "gateway",
    "plugins",
    "openclaw",
    "nodes",
    "computer",
    "mobile_ui",
    "agents_list",
    "get_goal",
    "create_goal",
    "update_goal",
    "progress_card",
    "ask_user",
    "skill_workshop",
    "skill_library",
    "skills_search",
    "skills_read",
    "view_image",
    "image_generate",
    "music_generate",
    "video_generate",
    "tts",
    "pdf",
  ]),
  "group:agents": new Set([
    "decision_evaluate",
    "agents_list",
    "get_goal",
    "create_goal",
    "update_goal",
    "progress_card",
    "ask_user",
    "skill_workshop",
    "skill_library",
    "skills_search",
    "skills_read",
  ]),
  "group:fs": new Set(["ls", "read", "write", "edit", "apply_patch"]),
  "group:runtime": new Set(["exec", "process", "code_execution", "secrets"]),
  "group:web": new Set(["web_search", "web_fetch", "x_search"]),
  "group:memory": new Set(["memory_search", "memory_get", "personal_instructions"]),
  "group:sessions": new Set([
    "presence",
    "sessions",
    "sessions_create",
    "sessions_list",
    "sessions_history",
    "sessions_search",
    "conversations_list",
    "conversations_send",
    "conversations_turn",
    "sessions_send",
    "sessions_spawn",
    "github_identity_status",
    "github_publish",
    "agents_wait",
    "sessions_yield",
    "subagents",
    "session_status",
    "suggest_task",
    "dismiss_task",
  ]),
  "group:ui": new Set([
    "browser",
    "screen",
    "theme",
    "dashboard",
    "terminal",
    "portal",
    "canvas",
    "show_widget",
  ]),
  "group:messaging": new Set(["message"]),
  "group:automation": new Set(["automations", "gateway", "plugins", "openclaw"]),
  "group:nodes": new Set(["nodes", "computer", "mobile_ui"]),
  "group:media": new Set([
    "view_image",
    "image_generate",
    "music_generate",
    "video_generate",
    "tts",
    "pdf",
  ]),
};

const StrictStringArraySchema = type("string[]");
export const nativeAgentSettingsFields = {
  groupChat: type({
    "+": "reject",
    mentionPatterns: StrictStringArraySchema.optional(),
  }).optional(),
  sandbox: type({
    "+": "reject",
    mode: '"off"|"non-main"|"all"?',
    scope: '"session"|"agent"|"shared"?',
    workspaceAccess: '"none"|"ro"|"rw"?',
  }).optional(),
  tools: type({
    "+": "reject",
    profile: "string?",
    allow: StrictStringArraySchema.optional(),
    alsoAllow: StrictStringArraySchema.optional(),
    deny: StrictStringArraySchema.optional(),
    fs: type({
      "+": "reject",
      workspaceOnly: "true?",
    }).optional(),
  }).optional(),
  memory: type({
    "+": "reject",
    search: type({
      "+": "reject",
      enabled: "boolean?",
      rememberAcrossConversations: "boolean?",
      sources: type("('memory' | 'sessions')[]").optional(),
    }).optional(),
  }).optional(),
  heartbeat: type({
    "+": "reject",
    every: "string?",
    activeHours: type({
      "+": "reject",
      start: "string?",
      end: "string?",
      timezone: "string?",
    }).optional(),
    lightContext: "boolean?",
    isolatedSession: "boolean?",
    timeoutSeconds: "number?",
  }).optional(),
  humanDelay: type({
    "+": "reject",
    mode: '"off"|"natural"|"custom"?',
    minMs: "number?",
    maxMs: "number?",
  }).optional(),
} as const;
const NativeAgentSettingsSchema = type({ "+": "reject", ...nativeAgentSettingsFields });
type NativeAgentSettings = (typeof NativeAgentSettingsSchema)[inferred];
type NativeAgentValidationIssue = { code: string; path: string; message: string };

function isStrictNonEmpty(value: string): boolean {
  return value.length > 0 && value === value.trim();
}

function normalizeOpenClawToolGrant(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "bash") return "exec";
  if (normalized === "apply-patch") return "apply_patch";
  if (normalized === "cron") return "automations";
  return normalized;
}

function isBoundedOpenClawToolGrant(value: string): boolean {
  if (!isStrictNonEmpty(value)) return false;
  const normalized = normalizeOpenClawToolGrant(value);
  if (
    /[*?[\]{}]/u.test(normalized) ||
    normalized === "bundle-mcp" ||
    normalized === "group:plugins"
  ) {
    return false;
  }
  if (normalized.startsWith("group:")) {
    return Object.hasOwn(OPENCLAW_STATIC_TOOL_GROUPS, normalized);
  }
  return !normalized.includes("__") || isConcreteOpenClawMcpToolName(value);
}

function isConcreteOpenClawMcpToolName(value: string): boolean {
  return value.length <= 64 && CONCRETE_MCP_TOOL_PATTERN.test(value);
}

function isOpenClawBuiltinProfile(value: string): value is OpenClawBuiltinProfile {
  return Object.hasOwn(OPENCLAW_PROFILE_TOOL_ALLOW, value);
}

function toolGrantOverlapsProfile(value: string, profile: OpenClawBuiltinProfile): boolean {
  if (profile === "full") return true;
  const normalized = normalizeOpenClawToolGrant(value);
  const group = OPENCLAW_STATIC_TOOL_GROUPS[normalized];
  return (
    OPENCLAW_PROFILE_TOOL_ALLOW[profile].has(normalized) ||
    (group !== undefined &&
      Array.from(group).some((tool) => OPENCLAW_PROFILE_TOOL_ALLOW[profile].has(tool))) ||
    ((profile === "coding" || profile === "messaging") && isConcreteOpenClawMcpToolName(value))
  );
}

function isValidDuration(value: string): boolean {
  if (!isStrictNonEmpty(value)) return false;
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  const normalized = value.toLowerCase();
  const single = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/.exec(normalized);
  if (single) {
    return Number.isSafeInteger(Math.round(Number(single[1]) * multipliers[single[2] ?? "m"]));
  }
  let totalMs = 0;
  let consumed = 0;
  for (const match of normalized.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)) {
    if (match.index !== consumed) return false;
    totalMs += Number(match[1]) * multipliers[match[2]];
    consumed += match[0].length;
  }
  return (
    consumed === normalized.length && consumed > 0 && Number.isSafeInteger(Math.round(totalMs))
  );
}

export function validateNativeAgentSettings(
  agent: NativeAgentSettings,
): NativeAgentValidationIssue[] {
  const issues: NativeAgentValidationIssue[] = [];
  const add = (path: string, message: string) =>
    issues.push({ code: "template_v1_invalid_agent_settings", path: `$.${path}`, message });
  const requireNonEmpty = (path: string, values: string[] | undefined) => {
    if (values !== undefined && values.length === 0) add(path, "Must contain at least one value.");
    for (const [index, entry] of (values ?? []).entries()) {
      if (!isStrictNonEmpty(entry)) {
        add(`${path}.${index}`, "Must be non-empty without leading or trailing whitespace.");
      }
    }
  };

  requireNonEmpty("agent.groupChat.mentionPatterns", agent?.groupChat?.mentionPatterns);
  const tools = agent?.tools;
  const profile = tools?.profile;
  if (profile !== undefined && !isStrictNonEmpty(profile)) {
    add("agent.tools.profile", "Must be non-empty without leading or trailing whitespace.");
  } else if (profile !== undefined && !isOpenClawBuiltinProfile(profile)) {
    add("agent.tools.profile", "Must name a registered OpenClaw built-in profile.");
  }
  requireNonEmpty("agent.tools.allow", agent?.tools?.allow);
  requireNonEmpty("agent.tools.alsoAllow", agent?.tools?.alsoAllow);
  requireNonEmpty("agent.tools.deny", agent?.tools?.deny);
  {
    for (const field of ["allow", "alsoAllow"] as const) {
      for (const [index, grant] of (tools?.[field] ?? []).entries()) {
        if (!isBoundedOpenClawToolGrant(grant)) {
          add(`agent.tools.${field}.${index}`, "Tool grants must be bounded concrete names.");
        }
      }
    }
  }
  if (tools?.alsoAllow && !profile) {
    add("agent.tools.alsoAllow", "May be set only when a built-in profile is selected.");
  }
  if (tools?.allow && tools.alsoAllow) {
    add("agent.tools.alsoAllow", "Must not be combined with tools.allow.");
  }
  if (profile && isOpenClawBuiltinProfile(profile)) {
    if (profile === "full" && !tools?.allow) {
      add("agent.tools.profile", "The full profile requires a bounded explicit allowlist.");
    }
    if ((profile === "coding" || profile === "messaging") && !tools?.allow) {
      add(
        "agent.tools.allow",
        "Profiles containing bundle MCP tools require a bounded explicit allowlist.",
      );
    }
    for (const [index, grant] of (tools?.allow ?? []).entries()) {
      if (isBoundedOpenClawToolGrant(grant) && !toolGrantOverlapsProfile(grant, profile)) {
        add(`agent.tools.allow.${index}`, "Must overlap the selected built-in profile.");
      }
    }
  }
  if (agent?.memory?.search?.sources?.length === 0) {
    add("agent.memory.search.sources", "Must contain at least one source.");
  }
  if (
    agent?.memory?.search?.sources?.includes("sessions") &&
    agent?.memory.search.rememberAcrossConversations !== true
  ) {
    add(
      "agent.memory.search.rememberAcrossConversations",
      "Must be true when memory.search.sources includes sessions.",
    );
  }
  const heartbeat = agent?.heartbeat;
  if (heartbeat?.every !== undefined && !isValidDuration(heartbeat.every)) {
    add("agent.heartbeat.every", "Must be a valid duration.");
  }
  const activeHours = heartbeat?.activeHours;
  if (activeHours?.start !== undefined && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(activeHours.start)) {
    add("agent.heartbeat.activeHours.start", "Must be a valid 24-hour start time.");
  }
  if (
    activeHours?.end !== undefined &&
    !/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(activeHours.end)
  ) {
    add("agent.heartbeat.activeHours.end", "Must be a valid 24-hour end time.");
  }
  if (activeHours?.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: activeHours.timezone }).format();
    } catch {
      add("agent.heartbeat.activeHours.timezone", "Must be a valid IANA timezone.");
    }
  }
  if (
    heartbeat?.timeoutSeconds !== undefined &&
    (!Number.isInteger(heartbeat.timeoutSeconds) || heartbeat.timeoutSeconds <= 0)
  ) {
    add("agent.heartbeat.timeoutSeconds", "Must be a positive integer.");
  }
  for (const field of ["minMs", "maxMs"] as const) {
    const delay = agent?.humanDelay?.[field];
    if (delay !== undefined && (!Number.isInteger(delay) || delay < 0)) {
      add(`agent.humanDelay.${field}`, "Must be a nonnegative integer.");
    }
  }
  return issues;
}
