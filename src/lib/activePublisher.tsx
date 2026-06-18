import { useQuery } from "convex/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { useAuthStatus } from "./useAuthStatus";

const ACTIVE_PUBLISHER_STORAGE_PREFIX = "clawhub-active-publisher";

type PublisherRole = "owner" | "admin" | "publisher";

type ActivePublisherMembership = {
  publisher: Pick<
    Doc<"publishers">,
    "_id" | "handle" | "displayName" | "kind" | "image" | "linkedUserId"
  > & {
    image?: string | null;
  };
  role: PublisherRole;
};

type ActivePublisherContextValue = {
  activePublisher: ActivePublisherMembership | null;
  activePublisherId: Id<"publishers"> | null;
  activeOwnerHandle: string | null;
  canManageActivePublisher: boolean;
  canPublishAsActivePublisher: boolean;
  canViewActivePublisherScope: boolean;
  hasMultiplePublishers: boolean;
  isLoading: boolean;
  memberships: ActivePublisherMembership[] | undefined;
  personalPublisher: ActivePublisherMembership | null;
  setActivePublisherId: (publisherId: Id<"publishers">) => void;
};

const ActivePublisherContext = createContext<ActivePublisherContextValue | null>(null);

function storageKeyForUser(userId: string) {
  return `${ACTIVE_PUBLISHER_STORAGE_PREFIX}:${userId}`;
}

function isManageRole(role: PublisherRole | undefined) {
  return role === "owner" || role === "admin";
}

function resolveFallbackPublisher(memberships: ActivePublisherMembership[] | undefined) {
  return memberships?.find((entry) => entry.publisher.kind === "user") ?? memberships?.[0] ?? null;
}

function resolveActivePublisher(
  memberships: ActivePublisherMembership[] | undefined,
  selectedPublisherId: string | null,
) {
  if (!memberships?.length) return null;
  if (selectedPublisherId) {
    const selected = memberships.find((entry) => entry.publisher._id === selectedPublisherId);
    if (selected) return selected;
  }
  return resolveFallbackPublisher(memberships);
}

function readStoredPublisherId(userId: string) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKeyForUser(userId));
  } catch {
    return null;
  }
}

function writeStoredPublisherId(userId: string, publisherId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyForUser(userId), publisherId);
  } catch {
    // Local persistence is best-effort; the in-memory active publisher still updates.
  }
}

function clearStoredPublisherId(userId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKeyForUser(userId));
  } catch {
    // Ignore storage failures; fallback selection still keeps the UI usable.
  }
}

export function ActivePublisherProvider({ children }: { children: ReactNode }) {
  const { isLoading: isAuthLoading, me } = useAuthStatus();
  const memberships = useQuery(api.publishers.listMineMemberships, me ? {} : "skip") as
    | ActivePublisherMembership[]
    | undefined;
  const [selectedPublisherId, setSelectedPublisherIdState] = useState<string | null>(null);
  const [pendingPublisherId, setPendingPublisherId] = useState<string | null>(null);
  const userId = me?._id ? String(me._id) : null;

  useEffect(() => {
    setSelectedPublisherIdState(userId ? readStoredPublisherId(userId) : null);
    setPendingPublisherId(null);
  }, [userId]);

  useEffect(() => {
    if (!userId || !memberships || !selectedPublisherId) return;
    const selectedStillExists = memberships.some(
      (entry) => entry.publisher._id === selectedPublisherId,
    );
    if (selectedStillExists) {
      if (pendingPublisherId === selectedPublisherId) setPendingPublisherId(null);
      return;
    }
    if (pendingPublisherId === selectedPublisherId) return;
    clearStoredPublisherId(userId);
    setSelectedPublisherIdState(null);
  }, [memberships, pendingPublisherId, selectedPublisherId, userId]);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return undefined;
    const key = storageKeyForUser(userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setSelectedPublisherIdState(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);

  const setActivePublisherId = useCallback(
    (publisherId: Id<"publishers">) => {
      if (!userId) return;
      const hasPublisher = memberships?.some((entry) => entry.publisher._id === publisherId);
      setPendingPublisherId(hasPublisher ? null : publisherId);
      setSelectedPublisherIdState(publisherId);
      writeStoredPublisherId(userId, publisherId);
    },
    [memberships, userId],
  );

  const activePublisher = resolveActivePublisher(memberships, selectedPublisherId);
  const personalPublisher = resolveFallbackPublisher(memberships);
  const activePublisherId = activePublisher?.publisher._id ?? null;
  const activeOwnerHandle = activePublisher?.publisher.handle ?? null;
  const canPublishAsActivePublisher = Boolean(activePublisher);
  const canManageActivePublisher = isManageRole(activePublisher?.role);
  const canViewActivePublisherScope = Boolean(activePublisher);
  const isLoading = Boolean(me) && (isAuthLoading || memberships === undefined);

  const value = useMemo<ActivePublisherContextValue>(
    () => ({
      activePublisher,
      activePublisherId,
      activeOwnerHandle,
      canManageActivePublisher,
      canPublishAsActivePublisher,
      canViewActivePublisherScope,
      hasMultiplePublishers: (memberships?.length ?? 0) > 1,
      isLoading,
      memberships,
      personalPublisher,
      setActivePublisherId,
    }),
    [
      activeOwnerHandle,
      activePublisher,
      activePublisherId,
      canManageActivePublisher,
      canPublishAsActivePublisher,
      canViewActivePublisherScope,
      isLoading,
      memberships,
      personalPublisher,
      setActivePublisherId,
    ],
  );

  return (
    <ActivePublisherContext.Provider value={value}>{children}</ActivePublisherContext.Provider>
  );
}

export function useActivePublisher() {
  const value = useContext(ActivePublisherContext);
  if (!value) {
    throw new Error("useActivePublisher must be used inside ActivePublisherProvider");
  }
  return value;
}
