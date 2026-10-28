import {
  EXPERIMENTAL_TEMPLATE_FEED_DESCRIPTION,
  EXPERIMENTAL_TEMPLATE_FEED_ID,
  parseExperimentalTemplateFeed,
  serializeExperimentalTemplateFeed,
} from "clawhub-schema";
import { TEMPLATE_FEED_STORAGE_ID } from "./templateStorage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Project a trusted stored snapshot without mutating its bytes, sequence, artifacts or records. */
export function projectStoredTemplateFeed(
  payload: string,
): { payload: string; entryCount: number } | null {
  try {
    let value: unknown = JSON.parse(payload);
    if (!isRecord(value)) return null;
    if (value.id === TEMPLATE_FEED_STORAGE_ID) {
      if (!Array.isArray(value.entries)) return null;
      const entries = value.entries.map((entry: unknown) => {
        if (!isRecord(entry) || entry.type !== "claw" || "templateManifestSummary" in entry) {
          throw new Error("Invalid historical Template entry");
        }
        const { clawManifestSummary, ...rest } = entry;
        return { ...rest, type: "template", templateManifestSummary: clawManifestSummary };
      });
      value = {
        ...value,
        id: EXPERIMENTAL_TEMPLATE_FEED_ID,
        description: EXPERIMENTAL_TEMPLATE_FEED_DESCRIPTION,
        entries,
      };
    }
    const feed = parseExperimentalTemplateFeed(value);
    // The physical snapshot marker and current publisher checks remain mandatory in the owning query.
    if (
      feed.entries.some(
        (entry) => !entry.id.startsWith("@openclaw/") || entry.publisher.id !== "openclaw",
      )
    )
      return null;
    return { payload: serializeExperimentalTemplateFeed(feed), entryCount: feed.entries.length };
  } catch {
    return null;
  }
}
