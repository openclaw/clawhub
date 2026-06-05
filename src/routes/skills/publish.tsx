import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import {
  PLATFORM_SKILL_LICENSE,
  PLATFORM_SKILL_LICENSE_NAME,
  PLATFORM_SKILL_LICENSE_SUMMARY,
} from "clawhub-schema/licenseConstants";
import { normalizeTextContentType } from "clawhub-schema/textFiles";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Check,
  CircleX,
  ExternalLink,
  FolderOpen,
  Info,
  Lock,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import semver from "semver";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { MAX_PUBLISH_FILE_BYTES, MAX_PUBLISH_TOTAL_BYTES } from "../../../convex/lib/publishLimits";
import { EmptyState } from "../../components/EmptyState";
import { Container } from "../../components/layout/Container";
import {
  PublisherOwnerSelect,
  type PublisherOwnerMembership,
} from "../../components/PublisherOwnerSelect";
import { PublishFormSkeleton } from "../../components/PublishFormSkeleton";
import { SignInButton } from "../../components/SignInButton";
import { SkillIconPicker } from "../../components/SkillIconPicker";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { UploadDropzoneDecor } from "../../components/UploadDropzoneDecor";
import { VersionInput } from "../../components/VersionInput";
import { getSiteMode } from "../../lib/site";
import { ALLOWED_LUCIDE_ICONS, makeLucideIconValue, parseSkillIcon } from "../../lib/skillIcon";
import { getPublicSlugCollision } from "../../lib/slugCollision";
import { expandDroppedItems, expandFilesWithReport } from "../../lib/uploadFiles";
import { useAuthStatus } from "../../lib/useAuthStatus";
import {
  formatBytes,
  formatPublishError,
  hashFile,
  isTextFile,
  readText,
  uploadFile,
} from "../upload/-utils";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_PUBLISHING_GUIDE_URL = "https://docs.openclaw.ai/clawhub/skill-format";
const SOUL_PUBLISHING_GUIDE_URL = "https://docs.openclaw.ai/clawhub/soul-format";

type SkillPublishField = "slug" | "displayName" | "version" | "tags" | "license";

export const Route = createFileRoute("/skills/publish")({
  validateSearch: (search) => ({
    updateSlug: typeof search.updateSlug === "string" ? search.updateSlug : undefined,
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  }),
  component: Upload,
});

export function Upload() {
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const { updateSlug, ownerHandle: searchOwnerHandle } = useSearch({ from: "/skills/publish" });
  const siteMode = getSiteMode();
  const isSoulMode = siteMode === "souls";
  const requiredFileLabel = isSoulMode ? "SOUL.md" : "SKILL.md";
  const contentLabel = isSoulMode ? "soul" : "skill";
  const publishingGuideUrl = isSoulMode ? SOUL_PUBLISHING_GUIDE_URL : SKILL_PUBLISHING_GUIDE_URL;
  const publishingGuideLabel = isSoulMode ? "Soul publishing guide" : "Skill publishing guide";
  const showChangelogField = Boolean(updateSlug);

  const generateUploadUrl = useMutation(api.uploads.generateUploadUrl);
  const publishVersion = useAction(
    isSoulMode ? api.souls.publishVersion : api.skills.publishVersion,
  );
  const generateChangelogPreview = useAction(
    isSoulMode ? api.souls.generateChangelogPreview : api.skills.generateChangelogPreview,
  );
  const existingSkill = useQuery(
    api.skills.getBySlug,
    !isSoulMode && updateSlug ? { slug: updateSlug } : "skip",
  );
  const existingSoul = useQuery(
    api.souls.getBySlug,
    isSoulMode && updateSlug ? { slug: updateSlug } : "skip",
  );
  const existing = (isSoulMode ? existingSoul : existingSkill) as
    | {
        skill?: { slug: string; displayName: string; icon?: string | null };
        soul?: { slug: string; displayName: string };
        latestVersion?: { version: string };
        // Present on skills.getBySlug; absent on souls.getBySlug. Used to
        // default the Owner selector to the skill's current owner in update
        // mode so a New Version publish does not silently re-own the skill.
        owner?: { handle: string; displayName?: string };
      }
    | null
    | undefined;

  const [hasAttempted, setHasAttempted] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [ignoredLocalMetadataPaths, setIgnoredLocalMetadataPaths] = useState<string[]>([]);
  const [pendingFileRemovalIndex, setPendingFileRemovalIndex] = useState<number | null>(null);
  const [slug, setSlug] = useState(updateSlug ?? "");
  const [displayName, setDisplayName] = useState("");
  const [dirtyFields, setDirtyFields] = useState<Record<SkillPublishField, boolean>>({
    slug: false,
    displayName: false,
    version: false,
    tags: false,
    license: false,
  });
  const [metadataPrefillNote, setMetadataPrefillNote] = useState<string | null>(null);
  // Selected lucide icon name (e.g. `Plug`) or null when "no icon". Skills only;
  // souls don't expose a custom icon yet.
  const [iconName, setIconName] = useState<string | null>(null);
  const [version, setVersion] = useState("1.0.0");
  const [tags, setTags] = useState("latest");
  const [acceptedLicenseTerms, setAcceptedLicenseTerms] = useState(false);
  const [changelog, setChangelog] = useState("");
  const [changelogStatus, setChangelogStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );
  const [changelogSource, setChangelogSource] = useState<"auto" | "user" | null>(null);
  const changelogTouchedRef = useRef(false);
  // Tracks whether the publisher has interacted with the Skill icon picker
  // during this session. Used by the submit handler to honour the "key
  // omitted = leave existing alone" branch in skill mode: a routine New
  // Version publish that never touches the picker must NOT forward an
  // empty `icon: ""` (which the backend would treat as an explicit
  // clear). This protects against silently wiping a custom icon when
  // pre-population fails — for example after the client allow-list is
  // pruned in a future deploy and the stored lucide name no longer
  // resolves.
  const iconTouchedRef = useRef(false);
  const changelogRequestRef = useRef(0);
  const changelogKeyRef = useRef<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const isSubmitting = status !== null;
  const [error, setError] = useState<string | null>(null);
  const publisherMemberships = useQuery(api.publishers.listMine, me ? {} : "skip") as
    | PublisherOwnerMembership[]
    | undefined;
  const [ownerHandle, setOwnerHandle] = useState(searchOwnerHandle ?? "");
  const ownerTouchedRef = useRef(false);
  // Owner migration opt-in: when updating an existing skill under a different
  // publisher than its current owner, the backend requires an explicit
  // `migrateOwner: true` signal. We only send it when the user ticks this box,
  // so a wrong default in the Owner selector cannot silently transfer
  // ownership.
  const [confirmMigrateOwner, setConfirmMigrateOwner] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const setFileInputRef = (node: HTMLInputElement | null) => {
    fileInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  };
  const navigate = useNavigate();

  function markFieldDirty(field: SkillPublishField) {
    setDirtyFields((current) => {
      if (current[field]) return current;
      return { ...current, [field]: true };
    });
  }

  function resetFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const totalBytes = useMemo(() => files.reduce((sum, file) => sum + file.size, 0), [files]);
  const stripRoot = useMemo(() => {
    if (files.length === 0) return null;
    const paths = files.map((file) => (file.webkitRelativePath || file.name).replace(/^\.\//, ""));
    if (!paths.every((path) => path.includes("/"))) return null;
    const firstSegment = paths[0]?.split("/")[0];
    if (!firstSegment) return null;
    if (!paths.every((path) => path.startsWith(`${firstSegment}/`))) return null;
    return firstSegment;
  }, [files]);
  const normalizedPaths = useMemo(
    () =>
      files.map((file) => {
        const raw = (file.webkitRelativePath || file.name).replace(/^\.\//, "");
        if (stripRoot && raw.startsWith(`${stripRoot}/`)) {
          return raw.slice(stripRoot.length + 1);
        }
        return raw;
      }),
    [files, stripRoot],
  );
  const normalizedFileEntries = useMemo(
    () =>
      files.map((file, index) => ({
        file,
        index,
        path: normalizedPaths[index] ?? file.name,
      })),
    [files, normalizedPaths],
  );
  const visibleFileEntries = useMemo(
    () =>
      [...normalizedFileEntries].sort((left, right) => {
        const leftRank = requiredFileSortRank(left.path, isSoulMode);
        const rightRank = requiredFileSortRank(right.path, isSoulMode);
        return leftRank === rightRank ? left.index - right.index : leftRank - rightRank;
      }),
    [isSoulMode, normalizedFileEntries],
  );
  const unsupportedFileEntries = useMemo(
    () => normalizedFileEntries.filter((entry) => !isTextFile(entry.file)),
    [normalizedFileEntries],
  );
  const hasRequiredFile = useMemo(
    () =>
      normalizedPaths.some((path) => {
        const lower = path.trim().toLowerCase();
        return isSoulMode ? lower === "soul.md" : lower === "skill.md" || lower === "skills.md";
      }),
    [isSoulMode, normalizedPaths],
  );
  const sizeLabel = totalBytes ? formatBytes(totalBytes) : "0 B";
  const oversizedFiles = useMemo(
    () => files.filter((file) => file.size > MAX_PUBLISH_FILE_BYTES),
    [files],
  );
  const oversizedFileNames = useMemo(
    () => oversizedFiles.slice(0, 3).map((file) => file.name),
    [oversizedFiles],
  );
  const ignoredLocalMetadataNote = useMemo(() => {
    if (ignoredLocalMetadataPaths.length === 0) return null;
    const labels = Array.from(
      new Set(ignoredLocalMetadataPaths.map((path) => path.split("/").at(-1) ?? path)),
    ).slice(0, 3);
    const suffix = ignoredLocalMetadataPaths.length > 3 ? ", ..." : "";
    const count = ignoredLocalMetadataPaths.length;
    return `Ignored ${count} local metadata file${count === 1 ? "" : "s"} (${labels.join(", ")}${suffix})`;
  }, [ignoredLocalMetadataPaths]);
  const trimmedSlug = slug.trim();
  const trimmedName = displayName.trim();
  const trimmedChangelog = changelog.trim();
  const trimmedVersion = version.trim();
  const slugAvailability = useQuery(
    api.skills.checkSlugAvailability,
    !isSoulMode && isAuthenticated && ownerHandle && trimmedSlug && SLUG_PATTERN.test(trimmedSlug)
      ? { slug: trimmedSlug.toLowerCase(), ownerHandle }
      : "skip",
  ) as
    | {
        available: boolean;
        reason: "available" | "taken" | "reserved";
        message: string | null;
        url: string | null;
      }
    | null
    | undefined;
  const slugCollision = useMemo(
    () =>
      getPublicSlugCollision({
        isSoulMode,
        slug: trimmedSlug,
        result: slugAvailability,
      }),
    [isSoulMode, slugAvailability, trimmedSlug],
  );

  useEffect(() => {
    if (!existing?.latestVersion || (!existing?.skill && !existing?.soul)) return;
    const name = existing.skill?.displayName ?? existing.soul?.displayName;
    const nextSlug = existing.skill?.slug ?? existing.soul?.slug;
    if (nextSlug) setSlug(nextSlug);
    if (name) setDisplayName(name);
    // Pre-populate the icon picker from the existing skill so a New Version
    // publish keeps the previously selected icon unless the user changes it.
    if (!isSoulMode && existing.skill?.icon !== undefined) {
      const parsed = parseSkillIcon(existing.skill.icon ?? null);
      setIconName(parsed?.kind === "lucide" ? parsed.name : null);
    }
    const nextVersion = semver.inc(existing.latestVersion.version, "patch");
    if (nextVersion) setVersion(nextVersion);
  }, [existing, isSoulMode]);

  useEffect(() => {
    if (isSoulMode) return;

    // In update mode, default the Owner selector to the skill's current owner
    // so the New Version flow is a same-owner republish by default and does
    // not require an ownership-migration opt-in for the common case.
    const existingOwnerHandle = existing?.owner?.handle;
    const memberships = publisherMemberships ?? [];
    if (memberships.length === 0) {
      if (!ownerHandle && existingOwnerHandle) {
        setOwnerHandle(existingOwnerHandle);
      }
      return;
    }

    const currentOwnerExists = ownerHandle
      ? memberships.some((entry) => entry.publisher.handle === ownerHandle)
      : false;
    const existingOwner = existingOwnerHandle
      ? memberships.find((entry) => entry.publisher.handle === existingOwnerHandle)
      : undefined;
    const shouldPreferExistingOwner = Boolean(
      !ownerTouchedRef.current &&
      updateSlug &&
      existingOwner &&
      ownerHandle !== existingOwner.publisher.handle,
    );
    if (currentOwnerExists && !shouldPreferExistingOwner) return;

    const personalPublisher = memberships.find((entry) => entry.publisher.kind === "user");
    const nextOwnerHandle =
      existingOwner?.publisher.handle ??
      personalPublisher?.publisher.handle ??
      memberships[0]?.publisher.handle;
    if (!nextOwnerHandle || nextOwnerHandle === ownerHandle) return;

    // Convex subscriptions can replace the owner option list after the first
    // render. Keep the controlled select value aligned so submit does not send
    // a stale handle while the DOM displays the replacement option.
    setOwnerHandle(nextOwnerHandle);
    setConfirmMigrateOwner(false);
  }, [ownerHandle, publisherMemberships, existing?.owner?.handle, updateSlug, isSoulMode]);

  useEffect(() => {
    if (!showChangelogField) return;
    if (changelogTouchedRef.current) return;
    if (trimmedChangelog) return;
    if (!trimmedSlug || !SLUG_PATTERN.test(trimmedSlug)) return;
    if (!semver.valid(trimmedVersion)) return;
    if (!hasRequiredFile) return;
    if (files.length === 0) return;

    const requiredIndex = normalizedPaths.findIndex((path) => {
      const lower = path.trim().toLowerCase();
      return isSoulMode ? lower === "soul.md" : lower === "skill.md" || lower === "skills.md";
    });
    if (requiredIndex < 0) return;

    const requiredFile = files[requiredIndex];
    if (!requiredFile) return;

    const key = `${trimmedSlug}:${trimmedVersion}:${requiredFile.size}:${requiredFile.lastModified}:${normalizedPaths.length}`;
    if (changelogKeyRef.current === key) return;
    changelogKeyRef.current = key;

    const requestId = ++changelogRequestRef.current;
    setChangelogStatus("loading");

    void readText(requiredFile)
      .then((text) => {
        if (changelogRequestRef.current !== requestId) return null;
        return generateChangelogPreview({
          slug: trimmedSlug,
          version: trimmedVersion,
          readmeText: text.slice(0, 20_000),
          filePaths: normalizedPaths,
        });
      })
      .then((result) => {
        if (!result) return;
        if (changelogRequestRef.current !== requestId) return;
        setChangelog(result.changelog);
        setChangelogSource("auto");
        setChangelogStatus("ready");
      })
      .catch(() => {
        if (changelogRequestRef.current !== requestId) return;
        setChangelogStatus("error");
      });
  }, [
    files,
    generateChangelogPreview,
    hasRequiredFile,
    isSoulMode,
    normalizedPaths,
    showChangelogField,
    trimmedChangelog,
    trimmedSlug,
    trimmedVersion,
  ]);
  // Detect ownership migration intent. We only treat it as a migration when:
  //   * updating an existing skill (`updateSlug` + loaded existing),
  //   * the caller has picked a different Owner than the skill currently has,
  //   * not in soul mode (souls don't carry a publisher owner).
  // The submit button is disabled until the user ticks the explicit
  // `confirmMigrateOwner` checkbox, mirroring the backend's `migrateOwner`
  // contract.
  const existingOwnerHandle = !isSoulMode ? (existing?.owner?.handle ?? null) : null;
  const isOwnerMigration = Boolean(
    !isSoulMode &&
    updateSlug &&
    existingOwnerHandle &&
    ownerHandle &&
    ownerHandle !== existingOwnerHandle,
  );
  const effectiveSlugCollision = isOwnerMigration && confirmMigrateOwner ? null : slugCollision;
  const parsedTags = useMemo(
    () =>
      tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    [tags],
  );
  const validation = useMemo(() => {
    const issues: string[] = [];
    if (!trimmedSlug) {
      issues.push("Slug is required.");
    } else if (!SLUG_PATTERN.test(trimmedSlug)) {
      issues.push("Slug must be lowercase and use dashes only.");
    }
    if (!trimmedName) {
      issues.push("Display name is required.");
    }
    if (!semver.valid(trimmedVersion)) {
      issues.push("Version must be valid semver (e.g. 1.0.0).");
    }
    if (parsedTags.length === 0) {
      issues.push("At least one tag is required.");
    }
    if (!isSoulMode && !acceptedLicenseTerms) {
      issues.push("Accept the MIT-0 license terms to publish this skill.");
    }
    if (files.length === 0) {
      issues.push("Add at least one file.");
    }
    if (!hasRequiredFile) {
      issues.push(`${requiredFileLabel} is required.`);
    }
    if (isOwnerMigration && !confirmMigrateOwner) {
      issues.push(
        `Confirm the ownership move from @${existingOwnerHandle} to @${ownerHandle} to publish.`,
      );
    }
    if (unsupportedFileEntries.length > 0) {
      issues.push(
        `Remove unsupported files: ${unsupportedFileEntries
          .slice(0, 3)
          .map((entry) => entry.path)
          .join(", ")}${unsupportedFileEntries.length > 3 ? ", ..." : ""}`,
      );
    }
    if (oversizedFiles.length > 0) {
      issues.push(`Each file must be 10MB or smaller: ${oversizedFileNames.join(", ")}`);
    }
    if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
      issues.push("Total file size exceeds 50MB.");
    }
    if (effectiveSlugCollision) {
      issues.push(effectiveSlugCollision.message);
    }
    return {
      issues,
      ready: issues.length === 0,
    };
  }, [
    trimmedSlug,
    trimmedName,
    trimmedVersion,
    parsedTags.length,
    acceptedLicenseTerms,
    files,
    unsupportedFileEntries,
    hasRequiredFile,
    isSoulMode,
    totalBytes,
    oversizedFiles.length,
    oversizedFileNames,
    requiredFileLabel,
    effectiveSlugCollision,
    isOwnerMigration,
    confirmMigrateOwner,
    existingOwnerHandle,
    ownerHandle,
  ]);
  const shouldShowSlugIssue = hasAttempted || dirtyFields.slug || Boolean(trimmedSlug);
  const shouldShowDisplayNameIssue = hasAttempted || dirtyFields.displayName;
  const shouldShowVersionIssue = hasAttempted || dirtyFields.version;
  const shouldShowTagsIssue = hasAttempted || dirtyFields.tags;
  const shouldShowFileIssues = hasAttempted || files.length > 0;

  const slugIssue = shouldShowSlugIssue
    ? validation.issues.find(
        (issue) =>
          issue === "Slug is required." ||
          issue.startsWith("Slug must ") ||
          issue === effectiveSlugCollision?.message,
      )
    : undefined;
  const slugCollisionIssue =
    effectiveSlugCollision && slugIssue === effectiveSlugCollision.message
      ? effectiveSlugCollision
      : null;
  const showSlugAvailableIcon =
    Boolean(trimmedSlug) &&
    SLUG_PATTERN.test(trimmedSlug) &&
    slugAvailability?.available === true &&
    !slugIssue;
  const showSlugUnavailableIcon = Boolean(slugCollisionIssue);
  const showSlugStatusIcon = showSlugAvailableIcon || showSlugUnavailableIcon;
  const displayNameIssue = shouldShowDisplayNameIssue
    ? validation.issues.find((issue) => issue === "Display name is required.")
    : undefined;
  const versionIssue = shouldShowVersionIssue
    ? validation.issues.find((issue) => issue.startsWith("Version must "))
    : undefined;
  const ownerIssue = validation.issues.find((issue) => issue.startsWith("Confirm the ownership "));
  const visibleMetadataIssues = validation.issues.filter((issue) => {
    if (issue.startsWith("Slug")) return false;
    if (issue.startsWith("Display name")) return false;
    if (issue.startsWith("Version")) return false;
    if (issue.startsWith("At least one tag")) return shouldShowTagsIssue;
    if (issue === effectiveSlugCollision?.message) return false;
    return false;
  });
  const visibleFileIssues = validation.issues.filter((issue) => {
    if (issue.startsWith("Add at least one file")) return hasAttempted;
    if (issue === `${requiredFileLabel} is required.`) return false;
    if (issue.startsWith("Remove unsupported files")) return shouldShowFileIssues;
    if (issue.startsWith("Each file")) return shouldShowFileIssues;
    if (issue.startsWith("Total file size")) return shouldShowFileIssues;
    return false;
  });
  const hasFilePanelFooter = Boolean(ignoredLocalMetadataNote || visibleFileIssues.length > 0);
  const publishBlockerSummary =
    !validation.ready && !isSubmitting
      ? summarizePublishBlockers(validation.issues, requiredFileLabel)
      : null;

  // webkitdirectory/directory attributes are set via the ref callback (setFileInputRef)
  // to ensure they persist across hydration and re-renders (#58)

  if (isAuthLoading) {
    return <PublishFormSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return (
      <main className="py-10">
        <Container size="narrow">
          <EmptyState
            title={`Sign in to publish a ${contentLabel}`}
            description="You need to be signed in to publish skills on ClawHub."
          >
            <SignInButton />
          </EmptyState>
        </Container>
      </main>
    );
  }

  async function applyExpandedFiles(selected: File[]) {
    const report = await expandFilesWithReport(selected);
    setFiles(report.files);
    setIgnoredLocalMetadataPaths(report.ignoredLocalMetadataPaths);
    setPendingFileRemovalIndex(null);
    setMetadataPrefillNote(null);
    resetFileInput();

    if (updateSlug) return;

    const folderName = getSharedTopLevelFolderName(report.files);
    if (!folderName) return;

    const nextSlug = slugFromFolderName(folderName);
    const nextDisplayName = displayNameFromFolderName(folderName);
    const prefilled: string[] = [];
    if (nextSlug && !dirtyFields.slug && !trimmedSlug) {
      setSlug(nextSlug);
      prefilled.push("slug");
    }
    if (nextDisplayName && !dirtyFields.displayName && !trimmedName) {
      setDisplayName(nextDisplayName);
      prefilled.push("display name");
    }
    if (prefilled.length > 0) {
      setMetadataPrefillNote(`Suggested ${prefilled.join(" and ")} from the selected folder.`);
    }
  }

  function handleFilesDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const items = event.dataTransfer.items;
    void (async () => {
      const dropped = items?.length
        ? await expandDroppedItems(items)
        : Array.from(event.dataTransfer.files);
      await applyExpandedFiles(dropped);
    })();
  }

  function clearSelectedFiles() {
    setFiles([]);
    setIgnoredLocalMetadataPaths([]);
    setPendingFileRemovalIndex(null);
    setMetadataPrefillNote(null);
    resetFileInput();
  }

  function removeFileAtIndex(index: number) {
    setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index));
    setPendingFileRemovalIndex(null);
    resetFileInput();
  }

  function removeUnsupportedFiles() {
    setFiles((current) => current.filter((file) => isTextFile(file)));
    setPendingFileRemovalIndex(null);
    resetFileInput();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setHasAttempted(true);
    if (!validation.ready) {
      const message = validation.issues[0] ?? "Fix validation issues to continue.";
      setError(message);
      toast.error(message);
      return;
    }
    if (effectiveSlugCollision) {
      setError(effectiveSlugCollision.message);
      toast.error(effectiveSlugCollision.message);
      return;
    }
    if (!isSoulMode && !acceptedLicenseTerms) {
      const msg = "Accept the MIT-0 license terms to publish this skill.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setError(null);
    if (oversizedFiles.length > 0) {
      const msg = `Each file must be 10MB or smaller: ${oversizedFileNames.join(", ")}`;
      setError(msg);
      toast.error(msg);
      return;
    }
    if (totalBytes > MAX_PUBLISH_TOTAL_BYTES) {
      const msg = "Total size exceeds 50MB per version.";
      setError(msg);
      toast.error(msg);
      return;
    }
    if (!hasRequiredFile) {
      const msg = `${requiredFileLabel} is required.`;
      setError(msg);
      toast.error(msg);
      return;
    }
    setStatus("Uploading files…");

    const uploaded = [] as Array<{
      path: string;
      size: number;
      storageId: string;
      sha256: string;
      contentType?: string;
    }>;

    for (const file of files) {
      const uploadUrl = await generateUploadUrl();
      const rawPath = (file.webkitRelativePath || file.name).replace(/^\.\//, "");
      const path =
        stripRoot && rawPath.startsWith(`${stripRoot}/`)
          ? rawPath.slice(stripRoot.length + 1)
          : rawPath;
      const sha256 = await hashFile(file);
      const storageId = await uploadFile(uploadUrl, file);
      uploaded.push({
        path,
        size: file.size,
        storageId,
        sha256,
        contentType: normalizeTextContentType(path, file.type) ?? file.type ?? undefined,
      });
    }

    setStatus("Publishing…");
    try {
      // Skill mode forwards an `icon` field only when the picker has
      // actually been touched in this session, so the form is the single
      // source of truth for the tri-state contract:
      //   * touched + whitelisted name → `lucide:<Name>` (set)
      //   * touched + None / unparseable selection → `""` (clear)
      //   * untouched (or soul mode) → field omitted (keep existing)
      // The backend treats blank input as "clear the icon" and a missing
      // key as "keep whatever is already stored", so the omit branch is
      // what protects routine version bumps from silently wiping an
      // existing custom icon when pre-population fails (e.g. the stored
      // lucide name was pruned from `ALLOWED_LUCIDE_ICONS`).
      let iconPayload: string | undefined;
      if (isSoulMode || !iconTouchedRef.current) {
        iconPayload = undefined;
      } else if (iconName && Object.hasOwn(ALLOWED_LUCIDE_ICONS, iconName)) {
        iconPayload = makeLucideIconValue(iconName as keyof typeof ALLOWED_LUCIDE_ICONS);
      } else {
        iconPayload = "";
      }
      const result = await publishVersion({
        ownerHandle: isSoulMode ? undefined : ownerHandle || undefined,
        // Only propagate the migration opt-in when the user is actually
        // changing the skill's owner AND has explicitly confirmed the move.
        // Same-owner republishes must never carry `migrateOwner: true`.
        migrateOwner: !isSoulMode && isOwnerMigration && confirmMigrateOwner ? true : undefined,
        slug: trimmedSlug,
        displayName: trimmedName,
        ...(iconPayload !== undefined ? { icon: iconPayload } : {}),
        version: trimmedVersion,
        changelog: trimmedChangelog,
        acceptLicenseTerms: isSoulMode ? undefined : acceptedLicenseTerms,
        tags: parsedTags,
        files: uploaded,
      });
      setStatus(null);
      setError(null);
      setHasAttempted(false);
      setChangelogSource("user");
      if (result) {
        toast.success(`Published ${trimmedSlug}@${trimmedVersion}`);
        const ownerParam = ownerHandle || me?.handle || (me?._id ? String(me._id) : "unknown");
        void navigate({
          to: isSoulMode ? "/souls/$slug" : "/$owner/$slug",
          params: isSoulMode ? { slug: trimmedSlug } : { owner: ownerParam, slug: trimmedSlug },
        });
      }
    } catch (publishError) {
      setStatus(null);
      const message = formatPublishError(publishError);
      setError(message);
      toast.error(message);
    }
  }

  return (
    <main className="py-10">
      <Container size="narrow">
        <header className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">
              Publish a {contentLabel}
            </h1>
            <p className="text-sm text-[color:var(--ink-soft)]">
              Drop or select a {contentLabel} folder
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="w-fit">
            <a href={publishingGuideUrl} target="_blank" rel="noreferrer">
              {publishingGuideLabel}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        </header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* File upload panel */}
          <input
            ref={setFileInputRef}
            className="sr-only"
            id="upload-files"
            data-testid="upload-input"
            type="file"
            multiple
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? []);
              void applyExpandedFiles(picked);
            }}
          />

          {files.length > 0 ? (
            <div
              className={`overflow-hidden rounded-[var(--radius-md)] border transition-colors ${
                isDragging
                  ? "border-[color:var(--accent)] bg-[color:var(--accent)]/5"
                  : "border-[color:var(--line)] bg-[color:var(--surface-muted)]"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleFilesDrop}
            >
              <div className="flex flex-col gap-4 px-4 pt-4 pb-2 md:flex-row md:items-center md:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)]"
                    aria-hidden="true"
                  >
                    <FolderOpen className="h-4 w-4 text-[color:var(--ink-soft)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <strong className="text-sm text-[color:var(--ink)]">
                        Skill folder selected
                      </strong>
                      <span className="text-xs text-[color:var(--ink-soft)]">
                        {files.length} files · {sizeLabel}
                      </span>
                    </div>
                    {unsupportedFileEntries.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Badge variant="warning" size="sm">
                          {unsupportedFileEntries.length} unsupported
                        </Badge>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-4 md:justify-end">
                  {unsupportedFileEntries.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={removeUnsupportedFiles}
                    >
                      Remove unsupported
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Replace folder
                  </Button>
                  <button
                    type="button"
                    className="cursor-pointer text-xs font-medium text-[color:var(--ink-soft)] transition-colors hover:text-[color:var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg)]"
                    onClick={clearSelectedFiles}
                  >
                    Clear files
                  </button>
                </div>
              </div>
              <div className="mt-2 overflow-hidden rounded-t-[calc(var(--radius-md)+8px)] border-t border-[color:var(--line)] bg-[color:var(--surface)]">
                <div className="flex max-h-[300px] flex-col gap-1 overflow-y-auto p-3">
                  {!hasRequiredFile ? (
                    <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-status-error-fg/35 bg-status-error-bg px-3 py-1.5 text-sm text-status-error-fg">
                      <span className="min-w-0 flex-1 truncate font-mono">{requiredFileLabel}</span>
                      <Badge variant="destructive" size="sm">
                        Missing
                      </Badge>
                    </div>
                  ) : null}
                  {visibleFileEntries.map(({ file, index, path }) => {
                    const isUnsupported = !isTextFile(file);
                    const isConfirmingRemoval = pendingFileRemovalIndex === index;
                    return (
                      <div
                        key={`${index}:${path}`}
                        className={[
                          "flex items-center gap-2 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm bg-[color:var(--surface-muted)]",
                          isUnsupported ? "text-status-error-fg" : "text-[color:var(--ink-soft)]",
                        ].join(" ")}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono" title={path}>
                          {path}
                        </span>
                        {isUnsupported ? (
                          <Badge variant="warning" size="sm">
                            Unsupported
                          </Badge>
                        ) : null}
                        {isConfirmingRemoval ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-xs font-medium text-status-error-fg">
                              Remove?
                            </span>
                            <Button
                              aria-label={`Cancel removing ${path}`}
                              title={`Cancel removing ${path}`}
                              variant="ghost"
                              size="icon-xs"
                              type="button"
                              className="hover:not-disabled:bg-[color:var(--surface)]"
                              onClick={() => setPendingFileRemovalIndex(null)}
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              aria-label={`Confirm removing ${path}`}
                              title={`Confirm removing ${path}`}
                              variant="ghost"
                              size="icon-xs"
                              type="button"
                              className="text-status-error-fg hover:not-disabled:bg-status-error-bg hover:not-disabled:text-status-error-fg"
                              onClick={() => removeFileAtIndex(index)}
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        ) : (
                          <Button
                            aria-label={`Remove ${path}`}
                            title={`Remove ${path}`}
                            variant="ghost"
                            size="icon-xs"
                            type="button"
                            onClick={() => setPendingFileRemovalIndex(index)}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {hasFilePanelFooter ? (
                  <div className="border-t border-[color:var(--line)] bg-[color:var(--surface-muted)] px-3 py-2 text-xs text-[color:var(--ink-soft)]">
                    <div className="flex flex-col gap-1">
                      {ignoredLocalMetadataNote ? <p>{ignoredLocalMetadataNote}</p> : null}
                      {visibleFileIssues.map((issue) => (
                        <p
                          key={issue}
                          className={
                            issue.startsWith("Remove unsupported files")
                              ? "text-status-error-fg"
                              : undefined
                          }
                        >
                          {issue}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <Card>
              <CardContent>
                <div
                  className={`relative flex flex-col items-center gap-3 overflow-hidden rounded-[var(--radius-md)] border-2 border-dashed p-8 transition-colors ${
                    isDragging
                      ? "border-[color:var(--accent)] bg-[color:var(--accent)]/5"
                      : "border-[color:var(--line)] bg-[color:var(--surface-muted)]"
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleFilesDrop}
                >
                  <UploadDropzoneDecor active={isDragging} kind="skill" />
                  <div className="relative z-[1] flex flex-col items-center gap-2 text-center">
                    <div className="flex items-center gap-3">
                      <UploadIcon className="h-5 w-5 text-[color:var(--ink-soft)]" />
                      <strong>Drop a skill folder</strong>
                    </div>
                    <span className="text-xs text-[color:var(--ink-soft)]">
                      We keep inner paths and remove the top-level folder automatically.
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      Choose folder
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Metadata panel */}
          <Card>
            <CardContent className="gap-5">
              <div className="grid gap-x-4 gap-y-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="displayName">Display name</Label>
                  <Input
                    id="displayName"
                    value={displayName}
                    aria-invalid={Boolean(displayNameIssue)}
                    aria-describedby={
                      displayNameIssue ? "display-name-validation-error" : undefined
                    }
                    onChange={(event) => {
                      markFieldDirty("displayName");
                      setMetadataPrefillNote(null);
                      setDisplayName(event.target.value);
                    }}
                    placeholder={`My ${contentLabel}`}
                  />
                  <InlineValidationMessage
                    id="display-name-validation-error"
                    message={displayNameIssue}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="slug">Slug</Label>
                  <div className="relative">
                    <Input
                      id="slug"
                      value={slug}
                      aria-invalid={Boolean(slugIssue)}
                      aria-describedby={slugIssue ? "slug-validation-error" : undefined}
                      className={showSlugStatusIcon ? "pr-10" : undefined}
                      onChange={(event) => {
                        markFieldDirty("slug");
                        setMetadataPrefillNote(null);
                        setSlug(event.target.value);
                      }}
                      placeholder={`${contentLabel}-name`}
                    />
                    {showSlugAvailableIcon ? (
                      <Check
                        aria-label="Slug available"
                        className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-status-success-fg"
                      />
                    ) : null}
                    {showSlugUnavailableIcon ? (
                      <CircleX
                        aria-label="Slug unavailable"
                        className="pointer-events-none absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-status-error-fg"
                      />
                    ) : null}
                  </div>
                  <InlineValidationMessage id="slug-validation-error" message={slugIssue} />
                  {slugCollisionIssue?.url ? (
                    <a
                      href={slugCollisionIssue.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open existing skill in a new tab"
                      className="inline-flex w-fit items-center gap-1 text-sm text-[color:var(--ink-soft)] hover:text-[color:var(--accent)] hover:underline"
                    >
                      View existing skill
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
              </div>
              {metadataPrefillNote ? (
                <p
                  className="flex items-center gap-1.5 text-sm leading-5 text-[#1f6feb] dark:text-[#8fbdff]"
                  role="status"
                >
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="leading-5">{metadataPrefillNote}</span>
                </p>
              ) : null}

              {!isSoulMode ? (
                <div className="flex flex-col gap-3">
                  {/* The picker is a custom radiogroup; the visible "Icon"
                      heading is decorative and does not need `htmlFor` —
                      `SkillIconPicker` exposes its own `aria-label`. */}
                  <Label>Icon</Label>
                  <SkillIconPicker
                    value={iconName}
                    onChange={(next) => {
                      // Mark the picker as user-touched so the submit
                      // handler knows it can forward the resulting value
                      // (including `null` → "") instead of falling back
                      // to the omit-key branch.
                      iconTouchedRef.current = true;
                      setIconName(next);
                    }}
                  />
                </div>
              ) : null}

              {!isSoulMode ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="ownerHandle">Owner</Label>
                  <PublisherOwnerSelect
                    id="ownerHandle"
                    value={ownerHandle}
                    memberships={publisherMemberships}
                    onValueChange={(nextOwnerHandle) => {
                      ownerTouchedRef.current = true;
                      setOwnerHandle(nextOwnerHandle);
                      // Reset the migration confirmation any time the Owner
                      // selector changes; the user must re-acknowledge the move
                      // after picking a different target to avoid a stale tick
                      // turning into a silent transfer.
                      setConfirmMigrateOwner(false);
                    }}
                  />
                  {isOwnerMigration ? (
                    <label className="flex items-start gap-2 text-sm cursor-pointer mt-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmMigrateOwner}
                        onChange={(event) => setConfirmMigrateOwner(event.target.checked)}
                      />
                      <span>
                        Move ownership of <strong>{trimmedSlug || "this skill"}</strong> from{" "}
                        <strong>@{existingOwnerHandle}</strong> to <strong>@{ownerHandle}</strong>.
                        Versions, tags, stats, comments and stars are preserved; the old URL
                        redirects to the new one.
                      </span>
                    </label>
                  ) : null}
                  <InlineValidationMessage id="owner-validation-error" message={ownerIssue} />
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="version">Version</Label>
                <VersionInput
                  id="version"
                  value={version}
                  aria-invalid={Boolean(versionIssue)}
                  aria-describedby={versionIssue ? "version-validation-error" : undefined}
                  onValueChange={(nextVersion) => {
                    markFieldDirty("version");
                    setVersion(nextVersion);
                  }}
                  placeholder="1.0.0"
                />
                <InlineValidationMessage id="version-validation-error" message={versionIssue} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="tags">Tags</Label>
                <Input
                  id="tags"
                  value={tags}
                  onChange={(event) => {
                    markFieldDirty("tags");
                    setTags(event.target.value);
                  }}
                  placeholder="latest, stable"
                />
              </div>

              {visibleMetadataIssues.length > 0 ? (
                <ul className="flex flex-col gap-1 list-disc pl-5 text-sm text-[color:var(--ink-soft)]">
                  {visibleMetadataIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {!isSoulMode ? (
            <Card>
              <CardContent className="gap-4">
                <div>
                  <CardTitle>License</CardTitle>
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    {PLATFORM_SKILL_LICENSE} · {PLATFORM_SKILL_LICENSE_NAME}
                  </p>
                </div>
                <div className="flex flex-col gap-1 text-sm text-[color:var(--ink-soft)]">
                  <p>
                    All skills published on ClawHub are licensed under {PLATFORM_SKILL_LICENSE}.{" "}
                    {PLATFORM_SKILL_LICENSE_SUMMARY}
                  </p>
                  <p>
                    ClawHub does not support paid skills, per-skill pricing, or paywalled releases.
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-3 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[color:var(--accent)]"
                      checked={acceptedLicenseTerms}
                      onChange={(event) => {
                        setAcceptedLicenseTerms(event.target.checked);
                      }}
                    />
                    <span>
                      I have the rights to publish this skill under {PLATFORM_SKILL_LICENSE}.
                    </span>
                  </label>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {showChangelogField ? (
            <Card>
              <CardContent>
                <div>
                  <CardTitle>Changelog</CardTitle>
                  <p className="text-sm text-[color:var(--ink-soft)]">
                    Summarize what changed in this version.
                  </p>
                </div>
                <Label htmlFor="changelog" className="sr-only">
                  Changelog
                </Label>
                <Textarea
                  id="changelog"
                  rows={4}
                  value={changelog}
                  onChange={(event) => {
                    changelogTouchedRef.current = true;
                    setChangelogSource("user");
                    setChangelog(event.target.value);
                  }}
                  placeholder={`Describe what changed in this ${contentLabel}...`}
                />
                {changelogStatus === "loading" ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">Generating changelog…</div>
                ) : null}
                {changelogStatus === "error" ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    Could not auto-generate changelog.
                  </div>
                ) : null}
                {changelogSource === "auto" && changelog ? (
                  <div className="text-sm text-[color:var(--ink-soft)]">
                    Auto-generated changelog (edit as needed).
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Submit row */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-2">
              {error ? (
                <div className="text-sm font-medium text-red-600 dark:text-red-400" role="alert">
                  {error}
                </div>
              ) : null}
              {status ? <div className="text-sm text-[color:var(--ink-soft)]">{status}</div> : null}
              {publishBlockerSummary ? (
                <div className="text-sm font-medium text-status-error-fg">
                  {publishBlockerSummary}
                </div>
              ) : null}
            </div>
            <Button
              variant="primary"
              size="lg"
              type="submit"
              disabled={!validation.ready || isSubmitting}
              loading={isSubmitting}
            >
              {!validation.ready && !isSubmitting ? (
                <Lock className="h-4 w-4" aria-hidden="true" />
              ) : null}
              Publish {contentLabel}
            </Button>
          </div>
        </form>
      </Container>
    </main>
  );
}

function InlineValidationMessage(props: { id: string; message?: string }) {
  if (!props.message) return null;
  return (
    <p id={props.id} className="text-sm font-medium text-red-600 dark:text-red-400">
      {props.message}
    </p>
  );
}

function summarizePublishBlockers(issues: string[], requiredFileLabel: string) {
  const missing = issues.flatMap((issue) => missingPublishLabel(issue, requiredFileLabel));
  const uniqueMissing = [...new Set(missing)];
  if (uniqueMissing.length > 0) {
    return `Complete ${formatInlineList(uniqueMissing)} to publish.`;
  }
  return `Fix: ${issues[0] ?? "validation issues"}`;
}

function formatInlineList(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function missingPublishLabel(issue: string, requiredFileLabel: string) {
  if (issue === "Slug is required.") return ["slug"];
  if (issue === "Display name is required.") return ["display name"];
  if (issue === "At least one tag is required.") return ["tags"];
  if (issue === "Accept the MIT-0 license terms to publish this skill.") {
    return ["MIT-0 acceptance"];
  }
  if (issue === "Add at least one file.") return ["files"];
  if (issue === `${requiredFileLabel} is required.`) return [requiredFileLabel];
  return [];
}

function requiredFileSortRank(path: string, isSoulMode: boolean) {
  const normalized = path.trim().toLowerCase();
  if (isSoulMode) return normalized === "soul.md" ? 0 : 1;
  if (normalized === "skill.md") return 0;
  if (normalized === "skills.md") return 1;
  return 2;
}

function getSharedTopLevelFolderName(files: File[]) {
  if (files.length === 0) return null;
  const paths = files
    .map((file) => (file.webkitRelativePath || file.name).replace(/^\.\//, ""))
    .filter(Boolean);
  if (paths.length === 0 || paths.some((path) => !path.includes("/"))) return null;
  const firstSegment = paths[0]?.split("/").filter(Boolean)[0];
  if (!firstSegment) return null;
  return paths.every((path) => path.startsWith(`${firstSegment}/`)) ? firstSegment : null;
}

function slugFromFolderName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function displayNameFromFolderName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
