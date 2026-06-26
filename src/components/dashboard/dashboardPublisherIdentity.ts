import type { DashboardPublisherEntry } from "./types";

function normalizeIdentityText(value: string) {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

export function formatDashboardPublisherIdentity(publisher: DashboardPublisherEntry["publisher"]): {
  name: string | null;
  handle: string;
} {
  const handle = publisher.handle.trim();
  const rawName = publisher.displayName?.trim() ?? "";
  if (!rawName) return { name: null, handle };

  const normalizedName = normalizeIdentityText(rawName);
  const normalizedHandle = normalizeIdentityText(handle);
  if (normalizedName === normalizedHandle) return { name: null, handle };

  return { name: rawName, handle };
}

export function shouldShowDashboardPublisherRole(entry: DashboardPublisherEntry) {
  if (entry.publisher.kind === "user") return false;
  if (entry.role === "owner") return false;
  return true;
}

export function formatDashboardPublisherRole(role: DashboardPublisherEntry["role"]) {
  switch (role) {
    case "admin":
      return "Admin";
    case "publisher":
      return "Publisher";
    default:
      return "Owner";
  }
}
