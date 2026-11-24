import { ComposioError, type ComposioClient, updateComposioSession } from "./composio";
import { buildSessionToolConfig, sessionConfigKey } from "./connectionApps";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sliding lifetime of a chat's stored session, counted from its last use. */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** The expiry is extended at most this often, so relay requests stay read-mostly. */
export const SESSION_TOUCH_INTERVAL_MS = DAY_MS;

export type StoredSessionRef = { chatKey: string; composioSessionId: string };

/**
 * Sends the current tool configuration to each stored session that lacks it.
 *
 * Returns the sessions now up to date and the ones Composio no longer has.
 * A session whose update failed for another reason is in neither list and
 * stays marked stale, so it is reconciled again before it is next used.
 */
export async function pushSessionConfig(
  client: ComposioClient,
  sessions: Array<StoredSessionRef & { configKey: string }>,
  connectedAppIds: string[],
) {
  const configKey = sessionConfigKey(connectedAppIds);
  const config = buildSessionToolConfig(connectedAppIds);
  const synced: StoredSessionRef[] = [];
  const gone: StoredSessionRef[] = [];
  for (const session of sessions) {
    if (session.configKey === configKey) continue;
    const entry = { chatKey: session.chatKey, composioSessionId: session.composioSessionId };
    try {
      await updateComposioSession(client, session.composioSessionId, config);
      synced.push(entry);
    } catch (error) {
      if (!(error instanceof ComposioError)) throw error;
      if (error.status === 404) gone.push(entry);
      else console.warn("connections_session_sync_failed", { status: error.status });
    }
  }
  return { configKey, synced, gone };
}
