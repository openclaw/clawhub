export const Events = {
  GitHubSkillSourceSyncStarted: "github_skill_source_sync.started",
  GitHubSkillSourceSyncCompleted: "github_skill_source_sync.completed",
  GitHubSkillSourceSyncSourceFailed: "github_skill_source_sync.source_failed",
  GitHubSkillSourceSyncFailed: "github_skill_source_sync.failed",
  SecurityScanQueueSnapshot: "security_scan_queue.snapshot",
} as const;

export type EventName = (typeof Events)[keyof typeof Events];

type EventPayload = Record<string, unknown>;

export function logEvent(event: EventName, payload: EventPayload = {}) {
  console.log(JSON.stringify({ event, ...payload }));
}

export function logErrorEvent(event: EventName, payload: EventPayload = {}) {
  console.error(JSON.stringify({ event, ...payload }));
}
