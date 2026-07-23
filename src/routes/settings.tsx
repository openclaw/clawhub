import { useAuthActions } from "@convex-dev/auth/react";
import { Link, createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Building2,
  Check,
  CircleX,
  Code,
  Copy,
  GitBranch,
  KeyRound,
  Mail,
  Monitor,
  Moon,
  Package,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  Sun,
  Trash2,
  type LucideIcon,
  UserPlus,
  UserRound,
  Users,
  X,
  Upload,
} from "lucide-react";
import {
  type ComponentProps,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { copyText } from "../components/InstallCopyButton";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { SignInPrompt } from "../components/SignInPrompt";
import { SettingsSkeleton } from "../components/skeletons/ProtectedPageSkeletons";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { getUserFacingConvexError } from "../lib/convexError";
import { useThemeMode } from "../lib/theme";
import { timeAgo } from "../lib/timeAgo";
import { uploadFile } from "../lib/uploadUtils";
import { useAuthStatus } from "../lib/useAuthStatus";

const settingsViews = ["account", "organizations", "githubSources", "tokens", "danger"] as const;
type SettingsView = (typeof settingsViews)[number];

function isSettingsView(value: unknown): value is SettingsView {
  return typeof value === "string" && settingsViews.includes(value as SettingsView);
}

export const Route = createFileRoute("/settings")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    view?: SettingsView;
    ownerHandle?: string;
  } => ({
    view: isSettingsView(search.view) ? search.view : undefined,
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  }),
  component: Settings,
});

type ApiToken = {
  _id: Id<"apiTokens">;
  label: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
};

type PublisherMembership = {
  publisher: {
    _id: Id<"publishers">;
    handle: string;
    displayName: string;
    kind: "user" | "org";
    image?: string | null;
    imageStorageId?: Id<"_storage"> | null;
    bio?: string | null;
    githubHandle?: string | null;
    githubOrgId?: string | null;
    githubVerifiedAt?: number | null;
    official?: boolean;
    stats?: {
      skills: number;
      packages: number;
      installs: number;
      downloads: number;
      stars: number;
    };
  };
  role: "owner" | "admin" | "publisher";
};

type GitHubOrgMembershipsResult = {
  syncedAt: number | null;
  truncated: boolean;
  memberships: Array<{
    githubOrgId: string;
    login: string;
    avatarUrl: string | null;
    role: "admin" | "member";
    syncedAt: number;
  }>;
};

type PublisherDeletionInventory = {
  handle: string;
  stats: {
    skills: number;
    packages: number;
  };
  publishedItems: Array<{
    kind: "skill" | "plugin";
    displayName: string;
  }>;
};

type OrgMembersResult = {
  publisher: { _id: Id<"publishers">; handle: string } | null;
  members: Array<{
    role: "owner" | "admin" | "publisher";
    user: {
      _id: Id<"users">;
      handle: string | null;
      personalPublisherHandle?: string | null;
      displayName: string | null;
      image: string | null;
    };
  }>;
};

type PublisherInvite = FunctionReturnType<typeof api.publishers.listMyInvites>[number];
type PublisherInviteRole = PublisherInvite["role"];

type InviteResponseState = {
  inviteId: Id<"publisherInvites">;
  action: "accept" | "decline";
};

type GitHubSkillSource = {
  _id: Id<"githubSkillSources">;
  repo: string;
  ownerPublisher?: {
    _id: Id<"publishers">;
    handle: string;
    displayName: string;
  } | null;
  defaultBranch?: string;
  lastSyncStatus?: "ok" | "failed" | "skipped";
  lastSyncError?: string;
  lastSyncErrorAt?: number;
  displayManifestStatus?: "ok" | "missing" | "invalid" | "failed";
  displayManifestFetchedAt?: number;
  displayManifestCommit?: string;
  lastSyncIssues?: Array<{
    slug: string;
    path: string;
    displayName: string;
    kind: "invalid_slug" | "slug_conflict";
    severity: "error" | "warning";
    message: string;
    existingOwnerHandle?: string;
  }>;
  lastSyncInvalidSkills?: Array<{
    slug: string;
    path: string;
    displayName: string;
    error: string;
  }>;
  skills: Array<{
    _id: Id<"skills">;
    slug: string;
    displayName: string;
    githubPath?: string;
    githubCurrentStatus?: "present" | "missing" | "unknown";
  }>;
  createdAt: number;
  updatedAt: number;
};

const navigationGroups: Array<{
  items: Array<{
    view: SettingsView;
    label: string;
    mobileLabel: string;
    icon: LucideIcon;
  }>;
}> = [
  {
    items: [
      {
        view: "account",
        label: "Account & Preferences",
        mobileLabel: "Account",
        icon: UserRound,
      },
    ],
  },
  {
    items: [
      {
        view: "organizations",
        label: "Organizations",
        mobileLabel: "Orgs",
        icon: Building2,
      },
      {
        view: "githubSources",
        label: "GitHub Skill Sync",
        mobileLabel: "Skill Sync",
        icon: GitBranch,
      },
      { view: "tokens", label: "API tokens", mobileLabel: "Tokens", icon: KeyRound },
      {
        view: "danger",
        label: "Account deletion",
        mobileLabel: "Deletion",
        icon: ShieldAlert,
      },
    ],
  },
];

const settingsStickyTop = "calc(128px + var(--space-4))";
const settingsScrollMargin = "calc(128px + var(--space-5))";
const publishedSkillBadgeVariant = ["com", "pact"].join("") as ComponentProps<
  typeof Badge
>["variant"];
const themeToggleItemClass =
  "!h-20 min-w-0 flex-1 flex-col gap-2 !rounded-[var(--r-btn)] border border-[color:var(--line)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--ink-soft)] opacity-70 hover:border-[color:var(--border-ui-hover)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] hover:opacity-100 data-[state=on]:border-[color:var(--accent)] data-[state=on]:!bg-[color:var(--surface-muted)] data-[state=on]:text-[color:var(--ink)] data-[state=on]:opacity-100 sm:!w-28 sm:flex-none";

export function Settings() {
  const navigate = useNavigate();
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated, isLoading: isAuthLoading, me } = useAuthStatus();
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const shouldLoadAccountScopedQueries = Boolean(me) && !isDeletingAccount;
  const tokens = useQuery(api.tokens.listMine, shouldLoadAccountScopedQueries ? {} : "skip") as
    | Array<ApiToken>
    | undefined;
  const createToken = useMutation(api.tokens.create);
  const revokeToken = useMutation(api.tokens.revoke);
  const publisherMemberships = useQuery(
    api.publishers.listMine,
    shouldLoadAccountScopedQueries ? { includePublishedItems: false } : "skip",
  ) as Array<PublisherMembership> | undefined;
  const githubOrgMemberships = useQuery(
    api.githubOrgMemberships.listMine,
    shouldLoadAccountScopedQueries ? {} : "skip",
  ) as GitHubOrgMembershipsResult | undefined;
  const rolloutCapabilities = useQuery(api.rolloutCapabilities.getPublicCapabilities, {});
  const createOrg = useMutation(api.publishers.createOrg);
  const deleteOrg = useMutation(api.publishers.deleteOrg);
  const createOrgImageUpload = useMutation(api.publishers.createImageUpload);
  const updateOrgProfile = useMutation(api.publishers.updateProfile);
  const addOrgMember = useMutation(api.publishers.addMember);
  const removeOrgMember = useMutation(api.publishers.removeMember);
  const createMemberInvite = useMutation(api.publishers.createMemberInvite);
  const revokeMemberInvite = useMutation(api.publishers.revokeMemberInvite);
  const acceptMemberInvite = useMutation(api.publishers.acceptMemberInvite);
  const declineMemberInvite = useMutation(api.publishers.declineMemberInvite);
  const configureGitHubSource = useAction(api.githubSkillSync.configurePublicGitHubSkillSource);
  const deleteGitHubSource = useMutation(api.githubSkillSources.deleteForPublisher);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [tokenLabel, setTokenLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [orgHandle, setOrgHandle] = useState("");
  const [orgDisplayName, setOrgDisplayName] = useState("");
  const [createOrgError, setCreateOrgError] = useState<string | null>(null);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [selectedOrgHandle, setSelectedOrgHandle] = useState("");
  const [selectedOrgDisplayName, setSelectedOrgDisplayName] = useState("");
  const [selectedOrgBio, setSelectedOrgBio] = useState("");
  const [selectedOrgImage, setSelectedOrgImage] = useState("");
  const [selectedOrgImageFile, setSelectedOrgImageFile] = useState<File | null>(null);
  const [selectedOrgImagePreview, setSelectedOrgImagePreview] = useState<string | null>(null);
  const [selectedGitHubOrgId, setSelectedGitHubOrgId] = useState("");
  const [isUploadingOrgImage, setIsUploadingOrgImage] = useState(false);
  const [selectedSourcePublisherId, setSelectedSourcePublisherId] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [isSyncingSource, setIsSyncingSource] = useState(false);
  const [deletingSourceId, setDeletingSourceId] = useState<Id<"githubSkillSources"> | null>(null);
  const [sourceToDelete, setSourceToDelete] = useState<GitHubSkillSource | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteOrgDialogOpen, setDeleteOrgDialogOpen] = useState(false);
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const [revokeTokenId, setRevokeTokenId] = useState<Id<"apiTokens"> | null>(null);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteHandle, setInviteHandle] = useState("");
  const [inviteRole, setInviteRole] = useState<PublisherInviteRole>("publisher");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<Id<"publisherInvites"> | null>(null);
  const [respondingInvite, setRespondingInvite] = useState<InviteResponseState | null>(null);
  const { activeView, navigateToView, ownerHandle: requestedOwnerHandle } = useActiveSettingsView();
  const orgs = (publisherMemberships ?? []).filter((entry) => entry.publisher.kind === "org");
  const manageablePublishers = (publisherMemberships ?? []).filter(
    (entry) => entry.role !== "publisher",
  );
  const officialGitHubSourcePublishers = manageablePublishers.filter(
    (entry) => entry.publisher.official === true,
  );
  const publisherMembershipsLoaded = publisherMemberships !== undefined;
  const canConfigureGitHubSources =
    rolloutCapabilities?.githubSkillSync.selfServiceEnabled === true &&
    officialGitHubSourcePublishers.length > 0;
  const effectiveActiveView =
    activeView === "githubSources" && publisherMembershipsLoaded && !canConfigureGitHubSources
      ? "account"
      : activeView;
  const selectedSourcePublisher =
    officialGitHubSourcePublishers.find(
      (entry) => entry.publisher._id === selectedSourcePublisherId,
    ) ??
    officialGitHubSourcePublishers[0] ??
    null;
  const selectedOrg =
    orgs.find((entry) => entry.publisher.handle === selectedOrgHandle) ?? orgs[0] ?? null;
  const githubOrgMembershipsFresh = Boolean(
    githubOrgMemberships?.syncedAt && Date.now() - githubOrgMemberships.syncedAt <= 15 * 60 * 1000,
  );
  const selectedGitHubOrgMembership = githubOrgMemberships?.memberships.find(
    (membership) => membership.githubOrgId === selectedGitHubOrgId,
  );
  const linkedGitHubHandleNeedsRefresh = Boolean(
    githubOrgMembershipsFresh &&
    selectedGitHubOrgId &&
    selectedGitHubOrgId === selectedOrg?.publisher.githubOrgId &&
    selectedGitHubOrgMembership &&
    selectedGitHubOrgMembership?.login !== selectedOrg.publisher.githubHandle,
  );
  const hasOrgProfileChanges = selectedOrg
    ? selectedOrgDisplayName !== (selectedOrg.publisher.displayName ?? "") ||
      selectedOrgBio !== (selectedOrg.publisher.bio ?? "") ||
      selectedOrgImage !== (selectedOrg.publisher.image ?? "") ||
      selectedGitHubOrgId !== (selectedOrg.publisher.githubOrgId ?? "") ||
      linkedGitHubHandleNeedsRefresh ||
      selectedOrgImageFile !== null
    : false;
  const hasProfileChanges = me
    ? displayName !== (me.displayName ?? "") || bio !== (me.bio ?? "")
    : false;
  const activeTokens = (tokens ?? []).filter((token) => !token.revokedAt);
  const revokedTokens = (tokens ?? []).filter((token) => token.revokedAt);
  const orgMembers = useQuery(
    api.publishers.listMembers,
    shouldLoadAccountScopedQueries &&
      activeView === "organizations" &&
      selectedOrg &&
      selectedOrg.role !== "publisher"
      ? { publisherHandle: selectedOrg.publisher.handle }
      : "skip",
  ) as OrgMembersResult | null | undefined;
  const pendingInvites = useQuery(
    api.publishers.listInvitesForPublisher,
    shouldLoadAccountScopedQueries &&
      activeView === "organizations" &&
      selectedOrg &&
      selectedOrg.role !== "publisher"
      ? { publisherId: selectedOrg.publisher._id }
      : "skip",
  ) as Array<PublisherInvite> | undefined;
  const myInvites = useQuery(
    api.publishers.listMyInvites,
    shouldLoadAccountScopedQueries && activeView === "organizations" ? {} : "skip",
  ) as Array<PublisherInvite> | undefined;
  const githubSources = useQuery(
    api.githubSkillSources.listForManageableOfficialPublishers,
    shouldLoadAccountScopedQueries &&
      effectiveActiveView === "githubSources" &&
      canConfigureGitHubSources
      ? {}
      : "skip",
  ) as GitHubSkillSource[] | undefined;
  const deletionInventory = useQuery(
    api.publishers.getDeletionInventory,
    shouldLoadAccountScopedQueries && deleteOrgDialogOpen && selectedOrg
      ? { publisherId: selectedOrg.publisher._id }
      : shouldLoadAccountScopedQueries && deleteDialogOpen
        ? {}
        : "skip",
  ) as PublisherDeletionInventory[] | undefined;

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.displayName ?? "");
    setBio(me.bio ?? "");
  }, [me]);

  useEffect(() => {
    if (selectedOrgHandle) return;
    if (orgs[0]?.publisher.handle) {
      setSelectedOrgHandle(orgs[0].publisher.handle);
    }
  }, [orgs, selectedOrgHandle]);

  useEffect(() => {
    if (!officialGitHubSourcePublishers.length) {
      setSelectedSourcePublisherId("");
      return;
    }
    const requestedPublisher = requestedOwnerHandle
      ? officialGitHubSourcePublishers.find(
          (entry) => entry.publisher.handle === requestedOwnerHandle,
        )
      : null;
    if (requestedPublisher) {
      setSelectedSourcePublisherId(requestedPublisher.publisher._id);
      return;
    }
    if (
      selectedSourcePublisherId &&
      officialGitHubSourcePublishers.some(
        (entry) => entry.publisher._id === selectedSourcePublisherId,
      )
    ) {
      return;
    }
    setSelectedSourcePublisherId(officialGitHubSourcePublishers[0]?.publisher._id ?? "");
  }, [officialGitHubSourcePublishers, requestedOwnerHandle, selectedSourcePublisherId]);

  useEffect(() => {
    if (!selectedOrg) {
      setSelectedOrgDisplayName("");
      setSelectedOrgBio("");
      setSelectedOrgImage("");
      setSelectedGitHubOrgId("");
      setSelectedOrgImageFile(null);
      return;
    }
    setSelectedOrgDisplayName(selectedOrg.publisher.displayName ?? "");
    setSelectedOrgBio(selectedOrg.publisher.bio ?? "");
    setSelectedOrgImage(selectedOrg.publisher.image ?? "");
    setSelectedGitHubOrgId(selectedOrg.publisher.githubOrgId ?? "");
    setSelectedOrgImageFile(null);
  }, [selectedOrg]);

  useEffect(() => {
    if (!selectedOrgImageFile) {
      setSelectedOrgImagePreview(null);
      return undefined;
    }
    const previewUrl = URL.createObjectURL(selectedOrgImageFile);
    setSelectedOrgImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedOrgImageFile]);

  if (isAuthLoading) {
    return <SettingsSkeleton />;
  }

  if (!isAuthenticated || !me) {
    return (
      <SignInPrompt
        title="Sign in to access settings"
        description="Manage your profile, organizations, and API access."
      />
    );
  }

  if (isDeletingAccount) {
    return <SettingsSkeleton />;
  }

  const activeSectionLoading =
    (activeView === "organizations" &&
      (publisherMemberships === undefined ||
        githubOrgMemberships === undefined ||
        (selectedOrg && selectedOrg.role !== "publisher" && orgMembers === undefined))) ||
    (activeView === "tokens" && tokens === undefined);

  if (activeSectionLoading) {
    return <SettingsSkeleton />;
  }

  const accountAvatar = me.image ?? undefined;
  const accountInitial = (displayName || me.displayName || me.name || me.handle || "U")
    .charAt(0)
    .toUpperCase();

  async function onSave(event: FormEvent) {
    event.preventDefault();
    await updateProfile({ displayName, bio });
    toast.success("Saved");
  }

  async function onDelete() {
    setDeleteDialogOpen(false);
    setIsDeletingAccount(true);
    try {
      await deleteAccount();
      // The account deletion mutation purges auth rows server-side; sign-out is best-effort
      // client cleanup before leaving the authenticated settings route.
      await signOut().catch(() => undefined);
      await navigate({ to: "/", replace: true });
    } catch (error) {
      setIsDeletingAccount(false);
      toast.error(getUserFacingConvexError(error, "Account could not be deleted."));
    }
  }

  async function onCreateToken() {
    const label = tokenLabel.trim() || "CLI token";
    const result = await createToken({ label });
    setNewToken(result.token);
    setTokenLabel("");
  }

  async function onCreateOrg() {
    setCreateOrgError(null);
    setIsCreatingOrg(true);
    try {
      const result = await createOrg({
        handle: orgHandle.trim(),
        displayName: orgDisplayName.trim() || orgHandle.trim(),
        bio: undefined,
      });
      if (result?.publisher?.handle) {
        setSelectedOrgHandle(result.publisher.handle);
        setOrgHandle("");
        setOrgDisplayName("");
        setCreateOrgDialogOpen(false);
        toast.success("Organization created");
      }
    } catch (error) {
      const message = getUserFacingConvexError(error, "Organization could not be created.");
      setCreateOrgError(message);
      toast.error(message);
    } finally {
      setIsCreatingOrg(false);
    }
  }

  async function onSaveOrgProfile() {
    if (!selectedOrg) return;
    setIsUploadingOrgImage(true);
    try {
      const githubOrgId =
        selectedGitHubOrgId === (selectedOrg.publisher.githubOrgId ?? "") &&
        !linkedGitHubHandleNeedsRefresh
          ? undefined
          : selectedGitHubOrgId || null;
      if (selectedOrgImageFile) {
        const upload = await createOrgImageUpload({
          publisherId: selectedOrg.publisher._id,
        });
        const imageStorageId = await uploadFile(upload.uploadUrl, selectedOrgImageFile);
        await updateOrgProfile({
          publisherId: selectedOrg.publisher._id,
          displayName: selectedOrgDisplayName,
          bio: selectedOrgBio || undefined,
          imageStorageId: imageStorageId as Id<"_storage">,
          imageUploadTicket: upload.uploadTicket,
          githubOrgId,
        });
      } else {
        await updateOrgProfile({
          publisherId: selectedOrg.publisher._id,
          displayName: selectedOrgDisplayName,
          bio: selectedOrgBio || undefined,
          image: selectedOrgImage || undefined,
          imageStorageId: selectedOrgImage
            ? (selectedOrg.publisher.imageStorageId ?? undefined)
            : undefined,
          githubOrgId,
        });
      }
      setSelectedOrgImageFile(null);
      toast.success("Organization updated");
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Organization could not be updated."));
    } finally {
      setIsUploadingOrgImage(false);
    }
  }

  async function onConnectGitHubOrganizations() {
    const ownerHandle = selectedOrg?.publisher.handle;
    const search = new URLSearchParams({ view: "organizations" });
    if (ownerHandle) search.set("ownerHandle", ownerHandle);
    await signIn("github", { redirectTo: `/settings?${search.toString()}` });
  }

  function onOrgImageFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Choose a PNG, JPEG, or WebP logo.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be smaller than 2 MB.");
      return;
    }
    setSelectedOrgImageFile(file);
  }

  async function onDeleteOrg() {
    if (!selectedOrg) return;
    const deletingHandle = selectedOrg.publisher.handle;
    await deleteOrg({ publisherId: selectedOrg.publisher._id });
    setDeleteOrgDialogOpen(false);
    const nextOrg = orgs.find((entry) => entry.publisher.handle !== deletingHandle);
    setSelectedOrgHandle(nextOrg?.publisher.handle ?? "");
    toast.success(`Deleted @${deletingHandle}`);
  }

  async function onCreateInvite() {
    if (!selectedOrg) return;
    const handle = inviteHandle.trim();
    if (!handle) {
      setInviteError("Enter a user handle.");
      return;
    }
    if (orgMembers === undefined) {
      setInviteError("Members are still loading.");
      return;
    }
    const normalizedHandle = normalizeSettingsHandle(handle);
    const existingMember = (orgMembers?.members ?? []).find(
      (member) =>
        normalizeSettingsHandle(member.user.handle) === normalizedHandle ||
        normalizeSettingsHandle(member.user.personalPublisherHandle) === normalizedHandle,
    );
    setInviteError(null);
    setIsCreatingInvite(true);
    try {
      if (existingMember) {
        await addOrgMember({
          publisherId: selectedOrg.publisher._id,
          userHandle: handle,
          role: inviteRole,
        });
      } else {
        await createMemberInvite({
          publisherId: selectedOrg.publisher._id,
          userHandle: handle,
          role: inviteRole,
        });
      }
      setInviteDialogOpen(false);
      setInviteHandle("");
      setInviteRole("publisher");
      toast.success(existingMember ? `Updated @${handle} role` : `Invitation sent to @${handle}`);
    } catch (error) {
      const message = getUserFacingConvexError(
        error,
        existingMember ? "Member role could not be updated." : "Invitation could not be sent.",
      );
      setInviteError(message);
      toast.error(message);
    } finally {
      setIsCreatingInvite(false);
    }
  }

  async function onRevokeInvite(invite: PublisherInvite) {
    setRevokingInviteId(invite._id);
    try {
      await revokeMemberInvite({ inviteId: invite._id });
      toast.success(`Invitation to @${invite.targetHandle} revoked`);
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Invitation could not be revoked."));
    } finally {
      setRevokingInviteId(null);
    }
  }

  async function onAcceptInvite(invite: PublisherInvite) {
    setRespondingInvite({ inviteId: invite._id, action: "accept" });
    try {
      await acceptMemberInvite({ inviteId: invite._id });
      toast.success(`Joined @${invite.publisher.handle}`);
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Invitation could not be accepted."));
    } finally {
      setRespondingInvite(null);
    }
  }

  async function onDeclineInvite(invite: PublisherInvite) {
    setRespondingInvite({ inviteId: invite._id, action: "decline" });
    try {
      await declineMemberInvite({ inviteId: invite._id });
      toast.success(`Invitation from @${invite.publisher.handle} declined`);
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "Invitation could not be declined."));
    } finally {
      setRespondingInvite(null);
    }
  }

  async function onConfigureGitHubSource(event: FormEvent) {
    event.preventDefault();
    if (!selectedSourcePublisher) return;
    const repo = parseGitHubRepoInput(githubRepo);
    if (!repo) return;
    setIsSyncingSource(true);
    try {
      const result = await configureGitHubSource({
        ownerPublisherId: selectedSourcePublisher.publisher._id,
        repo,
      });
      setGithubRepo("");
      toast.success(formatGitHubSourceSyncToast(result?.stats));
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "GitHub source could not be synced."));
    } finally {
      setIsSyncingSource(false);
    }
  }

  async function onDeleteGitHubSource(source: GitHubSkillSource) {
    const ownerPublisherId = source.ownerPublisher?._id ?? selectedSourcePublisher?.publisher._id;
    if (!ownerPublisherId) return;
    setDeletingSourceId(source._id);
    try {
      const result = await deleteGitHubSource({
        ownerPublisherId,
        sourceId: source._id,
      });
      toast.success(
        `GitHub sync deleted (${result.deletedSkills} ${
          result.deletedSkills === 1 ? "skill" : "skills"
        } deleted)`,
      );
      setSourceToDelete(null);
    } catch (error) {
      toast.error(getUserFacingConvexError(error, "GitHub sync could not be deleted."));
    } finally {
      setDeletingSourceId(null);
    }
  }

  return (
    <main className="border-b border-[color:var(--line)] bg-[color:var(--bg)]">
      <div
        className="mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10 lg:px-6"
        style={
          {
            maxWidth: "var(--page-max)",
            "--settings-sticky-top": settingsStickyTop,
            "--settings-scroll-margin": settingsScrollMargin,
          } as CSSProperties
        }
      >
        <header>
          <h1 className="font-display text-3xl font-black leading-none text-[color:var(--ink)]">
            Settings
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[color:var(--ink-soft)]">
            Account identity, publishing organizations, and API access for ClawHub.
          </p>
        </header>
        <Separator />

        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="lg:sticky lg:top-[var(--settings-sticky-top)] lg:w-[272px] lg:shrink-0">
            <div className="flex flex-col">
              <nav
                className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0"
                aria-label="Settings sections"
              >
                {navigationGroups.map((group, groupIndex) => (
                  <div
                    key={`settings-nav-group-${groupIndex}`}
                    className="contents lg:flex lg:shrink lg:flex-col lg:gap-1"
                  >
                    {group.items.map((item) => {
                      if (
                        item.view === "githubSources" &&
                        publisherMembershipsLoaded &&
                        !canConfigureGitHubSources
                      ) {
                        return null;
                      }
                      const active = effectiveActiveView === item.view;
                      return (
                        <button
                          key={item.view}
                          type="button"
                          onClick={() => navigateToView(item.view)}
                          aria-current={active ? "true" : undefined}
                          aria-label={item.label}
                          className={`settings-sidebar-link inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm font-semibold no-underline transition-colors hover:no-underline lg:min-h-10 lg:px-2 ${
                            active
                              ? "bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] text-[color:var(--ink)]"
                              : "text-[color:var(--ink-soft)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] hover:text-[color:var(--ink)]"
                          }`}
                        >
                          <item.icon
                            size={16}
                            className={
                              active
                                ? "text-[color:var(--ink)] opacity-75"
                                : "text-[color:var(--ink-soft)] opacity-60"
                            }
                          />
                          <span className="lg:hidden">{item.mobileLabel}</span>
                          <span className="hidden lg:inline">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </div>
          </aside>

          <div className="flex min-w-0 flex-col lg:flex-1">
            <SettingsSection
              id="account"
              visible={effectiveActiveView === "account"}
              icon={<UserRound size={18} />}
              title="Account & Preferences"
              description="Profile details and interface preferences."
            >
              <div className="flex flex-col gap-5">
                <SettingsBlock>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <UserRound size={17} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">Account</h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          Public profile details used across skills, plugins, and publisher pages.
                        </p>
                      </div>
                    </div>
                    <Avatar className="hidden h-14 w-14 rounded-full sm:flex" title="github avatar">
                      {accountAvatar ? (
                        <AvatarImage src={accountAvatar} alt="GitHub avatar" />
                      ) : null}
                      <AvatarFallback>{accountInitial}</AvatarFallback>
                    </Avatar>
                  </div>

                  <form className="flex min-w-0 flex-col gap-4" onSubmit={onSave}>
                    <Field label="Display name" htmlFor="settings-display-name">
                      <Input
                        id="settings-display-name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </Field>
                    <Field label="Bio" htmlFor="settings-bio">
                      <Textarea
                        id="settings-bio"
                        rows={5}
                        value={bio}
                        onChange={(event) => setBio(event.target.value)}
                        placeholder="Tell people what you're building."
                      />
                    </Field>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                      {hasProfileChanges ? (
                        <span className="text-sm font-semibold text-status-error-fg">
                          You have unsaved changes.
                        </span>
                      ) : null}
                      <Button variant="primary" type="submit">
                        <Save size={16} />
                        Save profile
                      </Button>
                    </div>
                  </form>
                </SettingsBlock>

                <SettingsBlock>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <Palette size={17} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">Appearance</h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          Select your preferred theme.
                        </p>
                      </div>
                    </div>

                    <ToggleGroup
                      type="single"
                      value={themeMode}
                      onValueChange={(value) => {
                        if (!value) return;
                        setThemeMode(value as "system" | "light" | "dark");
                      }}
                      aria-label="Theme mode"
                      className="!h-auto w-full justify-start gap-2 !border-0 !bg-transparent !p-0 sm:w-auto lg:justify-end"
                    >
                      <ToggleGroupItem
                        value="system"
                        aria-label="System theme"
                        className={themeToggleItemClass}
                      >
                        <Monitor size={18} />
                        System
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="light"
                        aria-label="Light theme"
                        className={themeToggleItemClass}
                      >
                        <Sun size={18} />
                        Light
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="dark"
                        aria-label="Dark theme"
                        className={themeToggleItemClass}
                      >
                        <Moon size={18} />
                        Dark
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </SettingsBlock>
              </div>
            </SettingsSection>

            <SettingsSection
              id="organizations"
              visible={effectiveActiveView === "organizations"}
              icon={<Building2 size={18} />}
              title="Organizations"
              description="Publisher profiles and access."
            >
              <div className="flex flex-col gap-5">
                <InvitationsBlock
                  invites={myInvites}
                  respondingInvite={respondingInvite}
                  onAccept={(invite) => void onAcceptInvite(invite)}
                  onDecline={(invite) => void onDeclineInvite(invite)}
                />

                {orgs.length > 0 ? (
                  <>
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <Select
                        value={selectedOrg?.publisher.handle ?? ""}
                        onValueChange={setSelectedOrgHandle}
                      >
                        <SelectTrigger
                          id="settings-manage-org"
                          aria-label="Manage organization"
                          className="h-12 sm:min-w-[280px]"
                        >
                          {selectedOrg ? (
                            <span className="flex min-w-0 items-center gap-2">
                              <OrgLogoSmall
                                image={selectedOrg.publisher.image}
                                name={selectedOrg.publisher.displayName}
                                handle={selectedOrg.publisher.handle}
                                className="h-6 w-6"
                              />
                              <span className="truncate">
                                @{selectedOrg.publisher.handle} · {selectedOrg.role}
                              </span>
                            </span>
                          ) : (
                            <SelectValue placeholder="Select an org" />
                          )}
                        </SelectTrigger>
                        <SelectContent>
                          {orgs.map((entry) => (
                            <SelectItem key={entry.publisher._id} value={entry.publisher.handle}>
                              <span className="flex min-w-0 items-center gap-2">
                                <OrgLogoSmall
                                  image={entry.publisher.image}
                                  name={entry.publisher.displayName}
                                  handle={entry.publisher.handle}
                                  className="h-6 w-6"
                                />
                                <span className="truncate">
                                  @{entry.publisher.handle} · {entry.role}
                                </span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Dialog
                        open={createOrgDialogOpen}
                        onOpenChange={(open) => {
                          setCreateOrgDialogOpen(open);
                          if (open) setCreateOrgError(null);
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button variant="outline" type="button" className="h-12 sm:w-auto">
                            <Plus size={16} />
                            Add new org
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Create organization</DialogTitle>
                            <DialogDescription>
                              Create an organization for your team
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4">
                            <Field label="Handle" htmlFor="settings-org-handle">
                              <Input
                                id="settings-org-handle"
                                value={orgHandle}
                                onChange={(event) => {
                                  setOrgHandle(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="@openclaw"
                              />
                            </Field>
                            <Field label="Display name" htmlFor="settings-org-display-name">
                              <Input
                                id="settings-org-display-name"
                                value={orgDisplayName}
                                onChange={(event) => {
                                  setOrgDisplayName(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="OpenClaw"
                              />
                            </Field>
                          </div>
                          {createOrgError ? (
                            <p className="text-sm font-medium text-status-error-fg" role="alert">
                              {createOrgError}
                            </p>
                          ) : null}
                          <DialogFooter>
                            <Button variant="ghost" onClick={() => setCreateOrgDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              type="button"
                              disabled={!orgHandle.trim() || isCreatingOrg}
                              onClick={() => void onCreateOrg()}
                            >
                              {isCreatingOrg ? "Creating..." : "Create"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>

                    {selectedOrg && selectedOrg.role !== "publisher" ? (
                      <>
                        <SettingsBlock>
                          <div className="flex min-w-0 w-full flex-col gap-5">
                            <div className="flex min-w-0 items-center gap-4">
                              <OrgLogo
                                image={
                                  selectedOrgImagePreview ?? (selectedOrgImage.trim() || undefined)
                                }
                                name={selectedOrgDisplayName}
                                handle={selectedOrg.publisher.handle}
                                className="h-16 w-16"
                              />
                              <div className="min-w-0">
                                <h3 className="truncate text-base font-bold text-[color:var(--ink)]">
                                  {selectedOrgDisplayName || selectedOrg.publisher.handle}
                                </h3>
                                <p className="truncate text-sm text-[color:var(--ink-soft)]">
                                  @{selectedOrg.publisher.handle}
                                </p>
                              </div>
                            </div>

                            <div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-2">
                              <Field
                                label="Display name"
                                htmlFor="settings-selected-org-display-name"
                              >
                                <Input
                                  id="settings-selected-org-display-name"
                                  value={selectedOrgDisplayName}
                                  onChange={(event) =>
                                    setSelectedOrgDisplayName(event.target.value)
                                  }
                                  placeholder="OpenClaw"
                                />
                              </Field>
                              <div className="flex min-w-0 items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <Field label="Logo" htmlFor="settings-selected-org-image">
                                    <Input
                                      id="settings-selected-org-image"
                                      type="file"
                                      accept="image/png,image/jpeg,image/webp"
                                      onChange={onOrgImageFileChange}
                                      className="file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-[color:var(--surface-muted)] file:px-3 file:py-2 file:font-semibold file:text-[color:var(--ink)]"
                                    />
                                    <p className="mt-1 text-xs text-[color:var(--ink-soft)]">
                                      PNG, JPEG, or WebP up to 2 MB.
                                    </p>
                                  </Field>
                                </div>
                                {selectedOrgImage || selectedOrgImageFile ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Remove logo"
                                    className="mt-6 shrink-0"
                                    onClick={() => {
                                      setSelectedOrgImage("");
                                      setSelectedOrgImageFile(null);
                                    }}
                                  >
                                    <X size={15} />
                                  </Button>
                                ) : null}
                              </div>
                              <div className="lg:col-span-2">
                                <Field
                                  label="GitHub organization"
                                  htmlFor="settings-selected-org-github"
                                >
                                  {githubOrgMemberships?.syncedAt ||
                                  selectedOrg.publisher.githubOrgId ? (
                                    <>
                                      <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                                        <Select
                                          value={selectedGitHubOrgId || "__none__"}
                                          onValueChange={(value) =>
                                            setSelectedGitHubOrgId(
                                              value === "__none__" ? "" : value,
                                            )
                                          }
                                        >
                                          <SelectTrigger
                                            id="settings-selected-org-github"
                                            className="h-11 min-w-0 flex-1"
                                          >
                                            <SelectValue placeholder="Select a GitHub organization" />
                                          </SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="__none__">
                                              No GitHub organization
                                            </SelectItem>
                                            {selectedOrg.publisher.githubOrgId &&
                                            !(githubOrgMemberships?.memberships ?? []).some(
                                              (membership) =>
                                                membership.githubOrgId ===
                                                selectedOrg.publisher.githubOrgId,
                                            ) ? (
                                              <SelectItem
                                                value={selectedOrg.publisher.githubOrgId}
                                                disabled
                                              >
                                                @{selectedOrg.publisher.githubHandle} · unavailable
                                              </SelectItem>
                                            ) : null}
                                            {(githubOrgMemberships?.memberships ?? []).map(
                                              (membership) => (
                                                <SelectItem
                                                  key={membership.githubOrgId}
                                                  value={membership.githubOrgId}
                                                  disabled={!githubOrgMembershipsFresh}
                                                >
                                                  <span className="flex min-w-0 items-center gap-2">
                                                    <OrgLogoSmall
                                                      image={membership.avatarUrl}
                                                      name={membership.login}
                                                      handle={membership.login}
                                                      className="h-6 w-6"
                                                    />
                                                    <span className="truncate">
                                                      @{membership.login} · {membership.role}
                                                    </span>
                                                  </span>
                                                </SelectItem>
                                              ),
                                            )}
                                          </SelectContent>
                                        </Select>
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="h-11 shrink-0"
                                          onClick={() => void onConnectGitHubOrganizations()}
                                        >
                                          <RefreshCw size={16} />
                                          Refresh
                                        </Button>
                                      </div>
                                      <p className="text-xs text-[color:var(--ink-soft)]">
                                        {githubOrgMembershipsFresh
                                          ? "Only organizations where your GitHub account is an active member are shown."
                                          : "Reconnect GitHub to choose another organization. You can still remove the current link."}
                                      </p>
                                    </>
                                  ) : (
                                    <div className="flex min-w-0 flex-col items-start gap-2">
                                      <Button
                                        id="settings-selected-org-github"
                                        type="button"
                                        variant="outline"
                                        aria-label="Connect GitHub organizations"
                                        onClick={() => void onConnectGitHubOrganizations()}
                                      >
                                        <GitHubIcon size={16} />
                                        Connect GitHub
                                      </Button>
                                      <p className="text-xs text-[color:var(--ink-soft)]">
                                        GitHub will ask for read-only access to your organization
                                        memberships.
                                      </p>
                                    </div>
                                  )}
                                </Field>
                              </div>
                              <div className="lg:col-span-2">
                                <Field label="Bio" htmlFor="settings-selected-org-bio">
                                  <Textarea
                                    id="settings-selected-org-bio"
                                    rows={4}
                                    value={selectedOrgBio}
                                    onChange={(event) => setSelectedOrgBio(event.target.value)}
                                    placeholder="Tell people what this organization publishes."
                                  />
                                </Field>
                              </div>
                              <div className="flex flex-col gap-3 lg:col-span-2 lg:flex-row lg:items-center lg:justify-end">
                                {hasOrgProfileChanges ? (
                                  <span className="text-sm font-semibold text-status-error-fg">
                                    You have unsaved changes.
                                  </span>
                                ) : null}
                                <Button
                                  type="button"
                                  disabled={isUploadingOrgImage}
                                  onClick={() => void onSaveOrgProfile()}
                                >
                                  {selectedOrgImageFile ? <Upload size={16} /> : <Save size={16} />}
                                  {isUploadingOrgImage ? "Uploading..." : "Save changes"}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </SettingsBlock>

                        <SettingsBlock>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                                <Users size={16} />
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <h3 className="text-sm font-bold text-[color:var(--ink)]">
                                    Members
                                  </h3>
                                  <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                                    {(orgMembers?.members ?? []).length}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <Dialog
                              open={inviteDialogOpen}
                              onOpenChange={(open) => {
                                setInviteDialogOpen(open);
                                if (open) {
                                  setInviteError(null);
                                } else {
                                  setInviteHandle("");
                                  setInviteRole("publisher");
                                  setInviteError(null);
                                }
                              }}
                            >
                              <DialogTrigger asChild>
                                <Button variant="outline" type="button">
                                  <UserPlus size={15} />
                                  Invite member
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Invite member</DialogTitle>
                                  <DialogDescription>
                                    Send an invitation to @{selectedOrg.publisher.handle}. The
                                    invitee accepts or declines from their settings.
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4">
                                  <Field label="User handle" htmlFor="settings-invite-handle">
                                    <Input
                                      id="settings-invite-handle"
                                      value={inviteHandle}
                                      onChange={(event) => {
                                        setInviteHandle(event.target.value);
                                        setInviteError(null);
                                      }}
                                      placeholder="user-handle"
                                    />
                                  </Field>
                                  <Field label="Role" htmlFor="settings-invite-role">
                                    <Select
                                      value={inviteRole}
                                      onValueChange={(value) => {
                                        setInviteRole(value as PublisherInviteRole);
                                        setInviteError(null);
                                      }}
                                    >
                                      <SelectTrigger id="settings-invite-role" aria-label="Role">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="publisher">Publisher</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        {selectedOrg.role === "owner" ? (
                                          <SelectItem value="owner">Owner</SelectItem>
                                        ) : null}
                                      </SelectContent>
                                    </Select>
                                  </Field>
                                </div>
                                {inviteError ? (
                                  <p
                                    className="text-sm font-medium text-status-error-fg"
                                    role="alert"
                                  >
                                    {inviteError}
                                  </p>
                                ) : null}
                                <DialogFooter>
                                  <Button
                                    variant="ghost"
                                    onClick={() => setInviteDialogOpen(false)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    variant="primary"
                                    type="button"
                                    disabled={
                                      !inviteHandle.trim() ||
                                      isCreatingInvite ||
                                      orgMembers === undefined
                                    }
                                    onClick={() => void onCreateInvite()}
                                  >
                                    <Send size={15} />
                                    {isCreatingInvite ? "Sending..." : "Send invite"}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          </div>

                          <div className="flex min-w-0 flex-col gap-4">
                            {(orgMembers?.members ?? []).length ? (
                              <div className="divide-y divide-[color:var(--line)] overflow-hidden">
                                {orgMembers?.members.map((entry) => (
                                  <div
                                    key={`${entry.user._id}:${entry.role}`}
                                    className="flex items-center justify-between gap-3 py-3"
                                  >
                                    <div className="flex min-w-0 items-center gap-3">
                                      <Avatar className="h-9 w-9 rounded-full">
                                        {entry.user.image ? (
                                          <AvatarImage
                                            src={entry.user.image}
                                            alt={
                                              entry.user.displayName ?? entry.user.handle ?? "User"
                                            }
                                          />
                                        ) : null}
                                        <AvatarFallback>
                                          {(entry.user.displayName ?? entry.user.handle ?? "U")
                                            .charAt(0)
                                            .toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="flex min-w-0 flex-col gap-1">
                                        <div className="flex min-w-0 items-center gap-2">
                                          <span className="truncate pr-1 text-sm font-semibold text-[color:var(--ink)]">
                                            {entry.user.displayName ??
                                              entry.user.handle ??
                                              entry.user._id}
                                          </span>
                                          <Badge className="shrink-0 self-center px-2.5 py-0.5 text-fs-xs">
                                            {entry.role}
                                          </Badge>
                                        </div>
                                        <div className="truncate text-xs text-[color:var(--ink-soft)]">
                                          @{entry.user.handle ?? "user"}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex shrink-0 items-center">
                                      {entry.role !== "owner" ? (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          type="button"
                                          onClick={() =>
                                            void removeOrgMember({
                                              publisherId: selectedOrg.publisher._id,
                                              userId: entry.user._id,
                                            })
                                          }
                                        >
                                          Remove
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </SettingsBlock>

                        <PendingInvitesBlock
                          invites={pendingInvites}
                          viewerRole={selectedOrg.role}
                          revokingInviteId={revokingInviteId}
                          onRevoke={(invite) => void onRevokeInvite(invite)}
                        />

                        {selectedOrg.role === "owner" ? (
                          <SettingsBlock tone="danger">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 items-center gap-3">
                                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--oc-radius-inset)] border border-status-error-fg/30 bg-status-error-bg text-status-error-fg">
                                  <ShieldAlert size={17} />
                                </span>
                                <div className="min-w-0">
                                  <h3 className="text-sm font-bold text-status-error-fg">
                                    Delete organization
                                  </h3>
                                  <p className="text-sm text-[color:var(--ink-soft)]">
                                    Permanently remove this org and its published skills and
                                    plugins.
                                  </p>
                                </div>
                              </div>
                              <Dialog
                                open={deleteOrgDialogOpen}
                                onOpenChange={setDeleteOrgDialogOpen}
                              >
                                <DialogTrigger asChild>
                                  <Button variant="destructive" type="button" className="sm:w-auto">
                                    <Trash2 size={16} />
                                    Delete organization
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Delete organization</DialogTitle>
                                    <DialogDescription>
                                      Permanently delete @{selectedOrg.publisher.handle} and its
                                      published resources. This action cannot be undone.
                                    </DialogDescription>
                                  </DialogHeader>
                                  <DeletionResourceSummary
                                    inventory={deletionInventory}
                                    emptyLabel="This organization has no published skills or plugins."
                                  />
                                  <DialogFooter>
                                    <Button
                                      variant="ghost"
                                      onClick={() => setDeleteOrgDialogOpen(false)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      disabled={deletionInventory === undefined}
                                      onClick={() => void onDeleteOrg()}
                                    >
                                      Permanently delete organization
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </SettingsBlock>
                        ) : null}
                      </>
                    ) : selectedOrg ? (
                      <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)]/30 p-4 text-sm text-[color:var(--ink-soft)]">
                        You can publish under this org. Owners and admins manage profile and
                        members.
                      </div>
                    ) : null}
                  </>
                ) : null}

                {!orgs.length ? (
                  <SettingsBlock>
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                          <Building2 size={17} />
                        </span>
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold text-[color:var(--ink)]">
                            Create organization
                          </h3>
                          <p className="text-sm text-[color:var(--ink-soft)]">
                            Create an organization for your team
                          </p>
                        </div>
                      </div>
                      <Dialog
                        open={createOrgDialogOpen}
                        onOpenChange={(open) => {
                          setCreateOrgDialogOpen(open);
                          if (open) setCreateOrgError(null);
                        }}
                      >
                        <DialogTrigger asChild>
                          <Button variant="primary" type="button" className="lg:w-auto">
                            <Building2 size={16} />
                            Create org
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Create organization</DialogTitle>
                            <DialogDescription>
                              Create an organization for your team
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4">
                            <Field label="Handle" htmlFor="settings-org-handle-empty">
                              <Input
                                id="settings-org-handle-empty"
                                value={orgHandle}
                                onChange={(event) => {
                                  setOrgHandle(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="@openclaw"
                              />
                            </Field>
                            <Field label="Display name" htmlFor="settings-org-display-name-empty">
                              <Input
                                id="settings-org-display-name-empty"
                                value={orgDisplayName}
                                onChange={(event) => {
                                  setOrgDisplayName(event.target.value);
                                  setCreateOrgError(null);
                                }}
                                placeholder="OpenClaw"
                              />
                            </Field>
                          </div>
                          {createOrgError ? (
                            <p className="text-sm font-medium text-status-error-fg" role="alert">
                              {createOrgError}
                            </p>
                          ) : null}
                          <DialogFooter>
                            <Button variant="ghost" onClick={() => setCreateOrgDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              type="button"
                              disabled={!orgHandle.trim() || isCreatingOrg}
                              onClick={() => void onCreateOrg()}
                            >
                              {isCreatingOrg ? "Creating..." : "Create"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </SettingsBlock>
                ) : null}
              </div>
            </SettingsSection>

            <SettingsSection
              id="githubSources"
              visible={effectiveActiveView === "githubSources"}
              icon={<GitBranch size={18} />}
              title="GitHub Skill Sync"
              description="Public source-backed skill repos."
            >
              <div className="flex flex-col gap-5">
                <SettingsBlock>
                  <div className="flex flex-col gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <GitBranch size={17} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">
                          Sync GitHub skills repo
                        </h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          Add a public repo URL. ClawHub syncs metadata and scan results every 15
                          minutes. Users install your skills directly from your GitHub repo.
                        </p>
                      </div>
                    </div>

                    {selectedSourcePublisher ? (
                      <GitHubSourceForm
                        publisherOptions={officialGitHubSourcePublishers}
                        selectedPublisherId={selectedSourcePublisher.publisher._id}
                        onPublisherChange={setSelectedSourcePublisherId}
                        githubRepo={githubRepo}
                        onGithubRepoChange={setGithubRepo}
                        onConfigure={onConfigureGitHubSource}
                        isSyncing={isSyncingSource}
                      />
                    ) : (
                      <p className="rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)]/25 p-3 text-sm text-[color:var(--ink-soft)]">
                        You need a verified publisher profile before adding GitHub skill sync.
                      </p>
                    )}
                  </div>
                </SettingsBlock>

                <GitHubSourceList
                  sources={githubSources}
                  deletingSourceId={deletingSourceId}
                  onDeleteSource={setSourceToDelete}
                />
                <GitHubSourceDeleteDialog
                  source={sourceToDelete}
                  deletingSourceId={deletingSourceId}
                  onOpenChange={(open) => {
                    if (!open) setSourceToDelete(null);
                  }}
                  onConfirm={(source) => void onDeleteGitHubSource(source)}
                />
              </div>
            </SettingsSection>

            <SettingsSection
              id="tokens"
              visible={effectiveActiveView === "tokens"}
              icon={<KeyRound size={18} />}
              title="API tokens"
              description="CLI access. New tokens are shown once."
            >
              <div className="flex flex-col gap-5">
                <SettingsBlock>
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <KeyRound size={17} />
                      </span>
                      <div>
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">New token</h3>
                        <p className="text-sm text-[color:var(--ink-soft)]">
                          For ClawHub CLI authentication.
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="min-w-0 flex-1">
                        <Field label="Label" htmlFor="settings-token-label">
                          <Input
                            id="settings-token-label"
                            value={tokenLabel}
                            onChange={(event) => setTokenLabel(event.target.value)}
                            placeholder="Name your token"
                          />
                        </Field>
                      </div>
                      <Button
                        variant="primary"
                        type="button"
                        onClick={() => void onCreateToken()}
                        className="shrink-0"
                      >
                        <KeyRound size={16} />
                        Create token
                      </Button>
                    </div>
                  </div>
                </SettingsBlock>

                {newToken ? (
                  <div className="flex flex-col gap-3 rounded-[var(--oc-radius-surface)] border border-status-warning-fg/30 bg-status-warning-bg p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-status-warning-fg">
                      <ShieldAlert size={16} />
                      Copy this token now — it will not be shown again.
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <code className="min-w-0 flex-1 break-all rounded-[var(--radius-sm)] bg-[color:var(--surface)] px-3 py-2 text-sm font-mono text-[color:var(--ink)]">
                        {newToken}
                      </code>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          void copyText(newToken)
                            .then((didCopy) => {
                              if (didCopy) {
                                toast.success("Token copied");
                              } else {
                                toast.error("Failed to copy token");
                              }
                            })
                            .catch(() => {
                              toast.error("Failed to copy token");
                            });
                        }}
                      >
                        <Copy size={15} />
                        Copy token
                      </Button>
                    </div>
                  </div>
                ) : null}

                {(tokens ?? []).length ? (
                  <>
                    {activeTokens.length ? (
                      <TokenList
                        title="Active tokens"
                        tokens={activeTokens}
                        onRevoke={(tokenId) => setRevokeTokenId(tokenId)}
                      />
                    ) : null}

                    {revokedTokens.length ? (
                      <TokenList title="Revoked tokens" tokens={revokedTokens} />
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    icon={KeyRound}
                    title="No API tokens"
                    description="Create a token to authenticate CLI requests."
                  />
                )}
                <Dialog
                  open={Boolean(revokeTokenId)}
                  onOpenChange={(open) => {
                    if (!open) setRevokeTokenId(null);
                  }}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Revoke token</DialogTitle>
                      <DialogDescription>
                        Revoke this token permanently? Any CLI or automation using it will stop
                        working.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="ghost" onClick={() => setRevokeTokenId(null)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={!revokeTokenId}
                        onClick={() => {
                          if (!revokeTokenId) return;
                          void revokeToken({ tokenId: revokeTokenId }).then(() =>
                            setRevokeTokenId(null),
                          );
                        }}
                      >
                        <Trash2 size={16} />
                        Revoke token
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </SettingsSection>

            <SettingsSection
              id="danger"
              visible={effectiveActiveView === "danger"}
              icon={<ShieldAlert size={18} />}
              title="Account deletion"
              description="Delete your account permanently and hide personal published resources."
              tone="danger"
              hideHeader
            >
              <SettingsBlock>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                        <ShieldAlert size={18} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[color:var(--ink)]">
                          Account deletion
                        </h3>
                      </div>
                    </div>
                    <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                      <DialogTrigger asChild>
                        <Button variant="destructive" type="button" className="sm:w-auto">
                          <Trash2 size={16} />
                          Delete account
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Delete account</DialogTitle>
                          <DialogDescription>
                            This permanently deletes your account and eligible owned resources. This
                            action cannot be undone.
                          </DialogDescription>
                        </DialogHeader>
                        <DeletionResourceSummary
                          inventory={deletionInventory}
                          emptyLabel="No published skills or plugins are attached to your account."
                        />
                        <DialogFooter>
                          <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={deletionInventory === undefined}
                            onClick={() => void onDelete()}
                          >
                            Permanently delete account
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="flex items-start gap-3 rounded-[var(--oc-radius-control)] border border-status-error-fg/25 bg-status-error-bg p-4">
                    <ShieldAlert size={18} className="mt-0.5 shrink-0 text-status-error-fg" />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold text-status-error-fg">
                        This will permanently delete your account
                      </p>
                      <p className="text-sm text-[color:var(--ink-soft)]">
                        Your profile, API tokens, personal publisher resources, and sole-owner org
                        resources will be permanently removed.
                      </p>
                    </div>
                  </div>
                </div>
              </SettingsBlock>
            </SettingsSection>
          </div>
        </div>
      </div>
    </main>
  );
}

function formatGitHubSourceSyncToast(
  stats:
    | {
        discovered?: number;
        inserted?: number;
        revived?: number;
        conflicts?: number;
      }
    | undefined,
) {
  const discovered = stats?.discovered ?? 0;
  const inserted = stats?.inserted ?? 0;
  const revived = stats?.revived ?? 0;
  const conflicts = stats?.conflicts ?? 0;
  const visibleChanges = inserted + revived;
  const details = [
    `${discovered} ${discovered === 1 ? "skill" : "skills"} found`,
    visibleChanges > 0
      ? `${visibleChanges} ${visibleChanges === 1 ? "skill" : "skills"} added`
      : null,
    conflicts > 0 ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}` : null,
  ].filter(Boolean);
  return `GitHub source synced (${details.join(", ")})`;
}

function DeletionResourceSummary({
  inventory,
  emptyLabel,
}: {
  inventory: PublisherDeletionInventory[] | undefined;
  emptyLabel: string;
}) {
  if (inventory === undefined) {
    return (
      <div className="rounded-[var(--oc-radius-control)] border border-status-error-fg/30 bg-status-error-bg px-3 py-3 text-sm text-[color:var(--ink-soft)]">
        Loading published resources...
      </div>
    );
  }

  const totals = inventory.reduce(
    (acc, entry) => {
      acc.skills += entry.stats.skills;
      acc.plugins += entry.stats.packages;
      return acc;
    },
    { skills: 0, plugins: 0 },
  );
  const resources = inventory.flatMap((entry) =>
    entry.publishedItems.map((item) => ({
      ...item,
      publisherHandle: entry.handle,
    })),
  );
  const totalResources = totals.skills + totals.plugins;
  const summary =
    totalResources > 0
      ? `${totals.skills} skill${totals.skills === 1 ? "" : "s"} and ${totals.plugins} plugin${
          totals.plugins === 1 ? "" : "s"
        } will be permanently deleted.`
      : emptyLabel;

  return (
    <div className="overflow-hidden rounded-[var(--oc-radius-control)] border border-status-error-fg/30 bg-status-error-bg text-sm">
      <div className="border-b border-status-error-fg/25 px-3 py-2">
        <p className="font-semibold text-status-error-fg">Resources permanently deleted</p>
        <p className="mt-1 text-[color:var(--ink-soft)]">{summary}</p>
      </div>
      {resources.length ? (
        <div className="max-h-72 divide-y divide-red-300/25 overflow-auto dark:divide-red-500/20">
          {resources.map((resource, index) => {
            const Icon = resource.kind === "plugin" ? Package : Code;
            return (
              <div
                key={`${resource.kind}:${resource.publisherHandle}:${resource.displayName}:${index}`}
                className="flex min-w-0 items-start gap-3 bg-[color:var(--surface)]/80 px-3 py-2.5"
              >
                <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink-soft)]">
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="truncate font-semibold text-[color:var(--ink)]">
                      {resource.displayName}
                    </p>
                    <Badge
                      variant={resource.kind === "plugin" ? "review" : publishedSkillBadgeVariant}
                      size="sm"
                      className="w-fit shrink-0 capitalize"
                    >
                      {resource.kind}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-[color:var(--ink-soft)]">
                    @{resource.publisherHandle}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="bg-[color:var(--surface)]/80 px-3 py-3 text-sm text-[color:var(--ink-soft)]">
          {emptyLabel}
        </p>
      )}
    </div>
  );
}

function PendingInvitesBlock({
  invites,
  viewerRole,
  revokingInviteId,
  onRevoke,
}: {
  invites: PublisherInvite[] | undefined;
  viewerRole: "owner" | "admin" | "publisher";
  revokingInviteId: Id<"publisherInvites"> | null;
  onRevoke: (invite: PublisherInvite) => void;
}) {
  if (!invites || invites.length === 0) return null;

  return (
    <SettingsBlock>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
            <Mail size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[color:var(--ink)]">Pending invites</h3>
              <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                {invites.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[color:var(--line)] overflow-hidden">
        {invites.map((invite) => {
          const targetDisplayName =
            invite.targetUser?.displayName ?? invite.targetUser?.handle ?? invite.targetHandle;
          const inviterLabel = invite.inviter?.handle ?? invite.inviter?.displayName ?? "unknown";
          const isRevoking = revokingInviteId === invite._id;
          const canRevoke = invite.role !== "owner" || viewerRole === "owner";
          return (
            <div key={invite._id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-9 w-9 rounded-full">
                  {invite.targetUser?.image ? (
                    <AvatarImage src={invite.targetUser.image} alt={targetDisplayName} />
                  ) : null}
                  <AvatarFallback>
                    {(targetDisplayName || "U").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate pr-1 text-sm font-semibold text-[color:var(--ink)]">
                      @{invite.targetHandle}
                    </span>
                    <Badge className="shrink-0 self-center px-2.5 py-0.5 text-fs-xs">
                      {invite.role}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-[color:var(--ink-soft)]">
                    Invited by @{inviterLabel} · expires {formatShortDate(invite.expiresAt)}
                  </div>
                </div>
              </div>
              {canRevoke ? (
                <div className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={isRevoking}
                    onClick={() => onRevoke(invite)}
                  >
                    {isRevoking ? "Revoking..." : "Revoke"}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </SettingsBlock>
  );
}

function InvitationsBlock({
  invites,
  respondingInvite,
  onAccept,
  onDecline,
}: {
  invites: PublisherInvite[] | undefined;
  respondingInvite: InviteResponseState | null;
  onAccept: (invite: PublisherInvite) => void;
  onDecline: (invite: PublisherInvite) => void;
}) {
  if (!invites || invites.length === 0) return null;

  return (
    <SettingsBlock>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
            <Mail size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[color:var(--ink)]">Invitations</h3>
              <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                {invites.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[color:var(--line)] overflow-hidden">
        {invites.map((invite) => {
          const inviterLabel = invite.inviter?.handle ?? invite.inviter?.displayName ?? "unknown";
          const responseAction =
            respondingInvite?.inviteId === invite._id ? respondingInvite.action : null;
          const isResponding = responseAction !== null;
          return (
            <div key={invite._id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="h-9 w-9 rounded-[var(--radius-sm)]">
                  {invite.publisher.image ? (
                    <AvatarImage src={invite.publisher.image} alt={invite.publisher.displayName} />
                  ) : null}
                  <AvatarFallback>
                    {(invite.publisher.displayName || invite.publisher.handle || "O")
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate pr-1 text-sm font-semibold text-[color:var(--ink)]">
                      {invite.publisher.displayName || `@${invite.publisher.handle}`}
                    </span>
                    <Badge className="shrink-0 self-center px-2.5 py-0.5 text-fs-xs">
                      {invite.role}
                    </Badge>
                  </div>
                  <div className="truncate text-xs text-[color:var(--ink-soft)]">
                    @{invite.publisher.handle} · invited by @{inviterLabel} · expires{" "}
                    {formatShortDate(invite.expiresAt)}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  disabled={isResponding}
                  onClick={() => onDecline(invite)}
                >
                  <X size={15} />
                  {responseAction === "decline" ? "Declining..." : "Decline"}
                </Button>
                <Button
                  variant="primary"
                  type="button"
                  disabled={isResponding}
                  onClick={() => onAccept(invite)}
                >
                  <Check size={15} />
                  {responseAction === "accept" ? "Accepting..." : "Accept"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </SettingsBlock>
  );
}

function SettingsSection({
  id,
  icon,
  title,
  description,
  children,
  tone,
  headerAside,
  hideHeader = true,
  visible = true,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  tone?: "danger";
  headerAside?: ReactNode;
  hideHeader?: boolean;
  visible?: boolean;
}) {
  if (!visible) return null;

  return (
    <section
      id={id}
      aria-label={`${title}. ${description}`}
      className="scroll-mt-[var(--settings-scroll-margin)] lg:min-h-[calc(100vh-var(--settings-scroll-margin))]"
    >
      <div className="flex min-h-full flex-col gap-5">
        {hideHeader ? null : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span
                className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border ${
                  tone === "danger"
                    ? "border-status-error-fg/30 bg-status-error-bg text-status-error-fg"
                    : "border-[color:var(--oc-border-subtle)] bg-[color:var(--oc-bg-surface)] text-[color:var(--oc-text-primary)]"
                }`}
              >
                {icon}
              </span>
              <div className="min-w-0">
                <h2
                  className={`font-display text-2xl font-black leading-none ${
                    tone === "danger"
                      ? "text-status-error-fg"
                      : "text-[color:var(--oc-text-primary)]"
                  }`}
                >
                  {title}
                </h2>
              </div>
            </div>
            {headerAside ? <div className="shrink-0">{headerAside}</div> : null}
          </div>
        )}
        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function SettingsBlock({
  children,
  tone,
  className = "",
}: {
  children: ReactNode;
  tone?: "danger";
  className?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-4 rounded-[var(--radius-md)] border p-4 sm:p-5 ${
        tone === "danger"
          ? "border-status-error-fg/30 bg-status-error-bg"
          : "border-[color:var(--line)] bg-[color:var(--surface)]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

function OrgLogo({
  image,
  name,
  handle,
  className,
}: {
  image?: string | null;
  name: string;
  handle: string;
  className?: string;
}) {
  return (
    <span
      className={`settings-org-logo inline-flex overflow-hidden rounded-[var(--radius-sm)] ${className ?? ""}`}
    >
      <MarketplaceIcon kind="org" label={name || handle} imageUrl={image} size="md" />
    </span>
  );
}

function OrgLogoSmall({
  image,
  name,
  handle,
  className,
}: {
  image?: string | null;
  name: string;
  handle: string;
  className?: string;
}) {
  return (
    <span
      className={`settings-org-logo inline-flex overflow-hidden rounded-[var(--radius-sm)] ${className ?? ""}`}
    >
      <MarketplaceIcon kind="org" label={name || handle} imageUrl={image} size="xs" />
    </span>
  );
}

function GitHubSourceList({
  sources,
  deletingSourceId,
  onDeleteSource,
}: {
  sources: GitHubSkillSource[] | undefined;
  deletingSourceId: Id<"githubSkillSources"> | null;
  onDeleteSource: (source: GitHubSkillSource) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby="github-synced-repos-title">
      <div className="flex items-center gap-2">
        <h3 id="github-synced-repos-title" className="text-sm font-bold text-[color:var(--ink)]">
          Synced repositories
        </h3>
        <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
          {sources?.length ?? 0}
        </span>
      </div>

      {sources === undefined ? (
        <p className="text-sm text-[color:var(--ink-soft)]">Loading sources...</p>
      ) : sources.length ? (
        <div className="flex flex-col gap-3">
          {sources.map((source) => (
            <SettingsBlock key={source._id} className="overflow-hidden p-0 sm:p-0">
              <div className="flex flex-col gap-3 p-4 sm:p-5">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
                      <GitBranch size={17} />
                    </span>
                    <div className="min-w-0">
                      <h4 className="truncate text-base font-bold text-[color:var(--ink)]">
                        {source.repo}
                      </h4>
                      <a
                        href={`https://github.com/${source.repo}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block truncate text-sm text-[color:var(--ink-soft)] hover:text-[color:var(--ink-soft)] visited:text-[color:var(--ink-soft)]"
                      >
                        {`https://github.com/${source.repo}`}
                      </a>
                      {source.ownerPublisher ? (
                        <div className="mt-1 truncate text-xs font-semibold text-[color:var(--ink-soft)]">
                          @{source.ownerPublisher.handle}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <GitHubSourceHealth source={source} />

                <GitHubSourceSyncIssues source={source} />

                <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
                  <div className="flex items-center gap-2 border-b border-[color:var(--line)] px-3 py-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
                      Synced skills
                    </span>
                    <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                      {source.skills.length}
                    </span>
                  </div>
                  {source.skills.length ? (
                    <div className="divide-y divide-[color:var(--line)]">
                      {source.skills.map((skill) => (
                        <div
                          key={skill._id}
                          className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="min-w-0">
                            <Link
                              to="/$owner/skills/$slug"
                              params={{
                                owner: source.ownerPublisher?.handle ?? "",
                                slug: skill.slug,
                              }}
                              disabled={!source.ownerPublisher}
                              className="block truncate text-sm font-semibold text-[color:var(--ink)] no-underline hover:text-[color:var(--accent)] hover:no-underline"
                            >
                              {skill.displayName}
                            </Link>
                            <div className="truncate text-xs text-[color:var(--ink-soft)]">
                              {skill.githubPath ?? skill.slug}
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-mono text-[color:var(--ink-soft)]">
                            {skill.slug}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="px-3 py-3 text-sm text-[color:var(--ink-soft)]">
                      No published skills are currently synced from this repo.
                    </p>
                  )}
                </div>

                <div className="-mx-4 -mb-4 flex flex-col gap-3 border-t border-[color:var(--line)] px-4 py-4 sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <h5 className="text-sm font-bold text-[color:var(--ink)]">
                      Delete synced repo &amp; skills
                    </h5>
                    <p className="mt-1 text-sm leading-6 text-[color:var(--ink-soft)]">
                      This will delete the sync job for this repo and all published skills
                      associated to the repo. This action cannot be undone.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    loading={deletingSourceId === source._id}
                    className="shrink-0"
                    onClick={() => onDeleteSource(source)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </SettingsBlock>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={GitBranch}
          title="No synced repositories"
          description="Add a repo above to start syncing GitHub-backed skills."
        />
      )}
    </section>
  );
}

function GitHubSourceDeleteDialog({
  source,
  deletingSourceId,
  onOpenChange,
  onConfirm,
}: {
  source: GitHubSkillSource | null;
  deletingSourceId: Id<"githubSkillSources"> | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (source: GitHubSkillSource) => void;
}) {
  const isDeleting = Boolean(source && deletingSourceId === source._id);

  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(100%,640px)] flex-col gap-4">
        <DialogHeader>
          <DialogTitle>Delete {source?.repo ?? "synced repo"}</DialogTitle>
          <DialogDescription>
            This will delete the sync job and all published skills associated with this repo. This
            action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
          <div className="border-b border-[color:var(--line)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
            Skills to delete
          </div>
          {source?.skills.length ? (
            <div className="max-h-72 divide-y divide-[color:var(--line)] overflow-auto">
              {source.skills.map((skill) => (
                <div
                  key={skill._id}
                  className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                      {skill.displayName}
                    </div>
                    <div className="truncate text-xs text-[color:var(--ink-soft)]">
                      {skill.githubPath ?? skill.slug}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-mono text-[color:var(--ink-soft)]">
                    {skill.slug}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-3 py-3 text-sm text-[color:var(--ink-soft)]">
              No published skills are currently synced from this repo.
            </p>
          )}
        </div>

        <DialogFooter className="sm:block">
          <Button
            variant="destructive"
            type="button"
            className="w-full"
            disabled={!source || isDeleting}
            loading={isDeleting}
            onClick={() => {
              if (source) onConfirm(source);
            }}
          >
            <Trash2 size={16} />
            Delete synced repo &amp; skills
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GitHubSourceHealth({ source }: { source: GitHubSkillSource }) {
  const needsAttention =
    source.lastSyncStatus === "failed" ||
    source.displayManifestStatus === "failed" ||
    source.displayManifestStatus === "invalid";
  const latestError =
    source.lastSyncError ??
    (source.displayManifestStatus === "invalid"
      ? "skills.sh.json could not be parsed"
      : source.displayManifestStatus === "failed"
        ? "GitHub sync failed"
        : null);
  const lastSuccessfulSync =
    source.displayManifestFetchedAt ?? (source.lastSyncStatus === "ok" ? source.updatedAt : null);

  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
      <div className="border-b border-[color:var(--line)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
        Overview
      </div>
      <div className="divide-y divide-[color:var(--line)]">
        <GitHubSourceOverviewRow label="Status">
          <GitHubSourceStatusPill needsAttention={needsAttention} />
        </GitHubSourceOverviewRow>
        <GitHubSourceOverviewRow label="Last synced">
          {lastSuccessfulSync ? timeAgo(lastSuccessfulSync) : "Never"}
        </GitHubSourceOverviewRow>
        <GitHubSourceOverviewRow label="Current commit">
          {source.displayManifestCommit ? (
            <a
              href={`https://github.com/${source.repo}/commit/${source.displayManifestCommit}`}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--ink-soft)] no-underline hover:text-[color:var(--accent)] hover:no-underline visited:text-[color:var(--ink-soft)]"
            >
              {shortCommit(source.displayManifestCommit)}
            </a>
          ) : (
            "None"
          )}
        </GitHubSourceOverviewRow>
      </div>
      {needsAttention && latestError ? (
        <p className="border-t border-[color:var(--oc-border-subtle)] px-3 py-2 text-sm text-status-error-fg">
          <span className="font-semibold">Latest error:</span> {latestError}
        </p>
      ) : null}
    </div>
  );
}

function GitHubSourceSyncIssues({ source }: { source: GitHubSkillSource }) {
  const issues = getGitHubSourceSyncIssues(source);
  if (issues.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--line)]">
      <div className="flex items-center gap-2 border-b border-[color:var(--line)] px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
          Sync issues
        </span>
        <span className="inline-flex h-5 items-center rounded-[var(--oc-radius-control)] border border-status-error-fg/30 bg-status-error-bg px-2 text-[11px] font-semibold text-status-error-fg">
          {issues.length}
        </span>
      </div>
      <div className="divide-y divide-[color:var(--line)]">
        {issues.map((skill) => (
          <div
            key={`${skill.path}:${skill.slug}`}
            className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                {skill.displayName}
              </div>
              <div className="truncate text-xs text-[color:var(--ink-soft)]">{skill.path}</div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ink-soft)]">
                {formatGitHubSourceIssueKind(skill.kind)}
              </div>
            </div>
            <div className="shrink-0 text-left text-xs font-semibold text-status-error-fg sm:max-w-[40%] sm:text-right">
              {skill.message}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getGitHubSourceSyncIssues(source: GitHubSkillSource) {
  return (
    source.lastSyncIssues ??
    source.lastSyncInvalidSkills?.map((skill) => ({
      slug: skill.slug,
      path: skill.path,
      displayName: skill.displayName,
      kind: "invalid_slug" as const,
      severity: "error" as const,
      message: skill.error,
    })) ??
    []
  );
}

function formatGitHubSourceIssueKind(
  kind: NonNullable<GitHubSkillSource["lastSyncIssues"]>[number]["kind"],
) {
  switch (kind) {
    case "invalid_slug":
      return "Invalid slug";
    case "slug_conflict":
      return "Slug conflict";
    default:
      return kind;
  }
}

function GitHubSourceOverviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[color:var(--ink)] sm:text-[11px]">
        {label}
      </div>
      <div className="min-w-0 truncate text-sm font-semibold text-[color:var(--ink-soft)]">
        {children}
      </div>
    </div>
  );
}

function GitHubSourceStatusPill({ needsAttention }: { needsAttention: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded-[var(--oc-radius-control)] border px-2.5 text-xs font-semibold ${
        needsAttention
          ? "border-status-error-fg/30 bg-status-error-bg text-status-error-fg"
          : "border-status-success-fg/30 bg-status-success-bg text-status-success-fg"
      }`}
    >
      {needsAttention ? "Needs attention" : "Healthy"}
    </span>
  );
}

function GitHubSourceForm({
  publisherOptions,
  selectedPublisherId,
  onPublisherChange,
  githubRepo,
  onGithubRepoChange,
  onConfigure,
  isSyncing,
}: {
  publisherOptions: PublisherMembership[];
  selectedPublisherId: string;
  onPublisherChange: (publisherId: string) => void;
  githubRepo: string;
  onGithubRepoChange: (repo: string) => void;
  onConfigure: (event: FormEvent) => void;
  isSyncing: boolean;
}) {
  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={onConfigure}>
      <div className="min-w-0 sm:w-64 sm:shrink-0">
        <Field label="Publisher" htmlFor="settings-github-source-publisher">
          <Select value={selectedPublisherId} onValueChange={onPublisherChange}>
            <SelectTrigger id="settings-github-source-publisher">
              <SelectValue placeholder="Select org" />
            </SelectTrigger>
            <SelectContent>
              {publisherOptions.map((entry) => (
                <SelectItem key={entry.publisher._id} value={entry.publisher._id}>
                  @{entry.publisher.handle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Field label="GitHub repo URL" htmlFor="settings-github-repo">
            <Input
              id="settings-github-repo"
              value={githubRepo}
              onChange={(event) => onGithubRepoChange(event.target.value)}
              placeholder="https://github.com/owner/repo"
            />
          </Field>
        </div>
        <Button type="submit" disabled={!githubRepo.trim() || isSyncing} className="shrink-0">
          <Plus size={16} />
          {isSyncing ? "Adding..." : "Add repo"}
        </Button>
      </div>
    </form>
  );
}

function shortCommit(commit: string) {
  return commit.slice(0, 7);
}

function parseGitHubRepoInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const markdownUrl = trimmed.match(/\]\((https?:\/\/[^)]+)\)$/i)?.[1];
  const raw = markdownUrl ?? trimmed;
  const normalized = raw
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .replace(/\.git$/i, "")
    .split(/[?#]/)[0];
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return trimmed;
}

function TokenList({
  title,
  tokens,
  onRevoke,
}: {
  title: string;
  tokens: ApiToken[];
  onRevoke?: (tokenId: Id<"apiTokens">) => void;
}) {
  const isRevokedList = tokens.every((token) => token.revokedAt);

  return (
    <SettingsBlock className="gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface)] text-[color:var(--ink)]">
            <KeyRound size={16} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-[color:var(--ink)]">{title}</h3>
              <span className="inline-flex h-5 items-center rounded-full border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-2 text-[11px] font-semibold text-[color:var(--ink-soft)]">
                {tokens.length}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:block">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-40" />
            <col className="w-40" />
            <col className="w-28" />
          </colgroup>
          <thead>
            <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)]">
              <th className="pb-3 text-left font-semibold">
                <span className="pl-7">Name</span>
              </th>
              <th className="pb-3 text-left font-semibold">Created</th>
              <th className="pb-3 text-left font-semibold">Last used</th>
              <th className="pb-3 text-right font-semibold">
                {isRevokedList ? "Revoked" : "Action"}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--line)]">
            {tokens.map((token) => (
              <tr key={token._id}>
                <td className="py-4 align-middle">
                  <div className="flex min-w-0 items-center gap-3">
                    {token.revokedAt ? (
                      <CircleX
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-status-error-fg"
                      />
                    ) : (
                      <Code
                        size={16}
                        aria-hidden="true"
                        className="shrink-0 text-[color:var(--ink-muted)] opacity-60"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-[color:var(--ink)]">
                        {token.label}
                      </div>
                      <code className="font-mono text-xs text-[color:var(--ink-soft)]">
                        {token.prefix}...
                      </code>
                    </div>
                  </div>
                </td>
                <td className="py-4 align-middle text-xs text-[color:var(--ink-soft)]">
                  {formatShortDate(token.createdAt)}
                </td>
                <td className="py-4 align-middle">
                  <span
                    className={
                      token.lastUsedAt
                        ? "text-xs text-[color:var(--ink-soft)]"
                        : "text-xs font-semibold text-[color:var(--ink-muted)] opacity-70"
                    }
                  >
                    {token.lastUsedAt ? formatShortDate(token.lastUsedAt) : "Never"}
                  </span>
                </td>
                <td className="py-4 text-right align-middle">
                  {token.revokedAt ? (
                    <span className="text-xs text-[color:var(--ink-soft)]">
                      {formatShortDate(token.revokedAt)}
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => onRevoke?.(token._id)}
                      className="h-8 gap-2 px-0 text-xs text-status-error-fg hover:bg-transparent hover:opacity-80"
                    >
                      <Trash2 size={14} />
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 lg:hidden">
        {tokens.map((token) => (
          <div
            key={token._id}
            className="grid gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)]/25 p-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              {token.revokedAt ? (
                <CircleX size={16} aria-hidden="true" className="shrink-0 text-status-error-fg" />
              ) : (
                <Code
                  size={16}
                  aria-hidden="true"
                  className="shrink-0 text-[color:var(--ink-muted)] opacity-60"
                />
              )}
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-[color:var(--ink)]">
                  {token.label}
                </span>
                <code className="min-w-0 truncate font-mono text-xs text-[color:var(--ink-soft)]">
                  {token.prefix}...
                </code>
              </div>
            </div>

            <div className="flex items-center justify-between lg:block">
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)] lg:hidden">
                Created
              </span>
              <span className="text-xs text-[color:var(--ink-soft)]">
                {formatShortDate(token.createdAt)}
              </span>
            </div>

            <div className="flex items-center justify-between lg:block">
              <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[color:var(--ink-muted)] lg:hidden">
                Last used
              </span>
              <span
                className={
                  token.lastUsedAt
                    ? "text-xs text-[color:var(--ink-soft)]"
                    : "text-xs font-semibold text-[color:var(--ink-muted)] opacity-70"
                }
              >
                {token.lastUsedAt ? formatShortDate(token.lastUsedAt) : "Never"}
              </span>
            </div>

            <div className="flex justify-start lg:justify-end">
              {token.revokedAt ? (
                <span className="text-xs text-[color:var(--ink-soft)]">
                  Revoked {formatShortDate(token.revokedAt)}
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => onRevoke?.(token._id)}
                  className="h-8 gap-2 px-0 text-xs text-status-error-fg hover:bg-transparent hover:opacity-80"
                >
                  <Trash2 size={14} />
                  Revoke
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </SettingsBlock>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 w-full flex-col gap-2">
      <Label
        htmlFor={htmlFor}
        className="text-[14px] font-semibold tracking-[0.04em] text-[color:var(--ink-soft)]"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.02c-3.22.7-3.9-1.37-3.9-1.37-.52-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.39.96.1-.75.4-1.26.74-1.55-2.57-.3-5.28-1.29-5.28-5.73 0-1.27.45-2.3 1.2-3.12-.12-.3-.52-1.48.11-3.08 0 0 .98-.31 3.16 1.19a10.9 10.9 0 0 1 5.75 0c2.18-1.5 3.16-1.19 3.16-1.19.63 1.6.23 2.78.11 3.08.75.82 1.2 1.85 1.2 3.12 0 4.46-2.71 5.43-5.3 5.72.42.36.79 1.07.79 2.16v3.02c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
    </svg>
  );
}

function useActiveSettingsView() {
  const navigate = useNavigate({ from: "/settings" });
  const search = useSearch({ from: "/settings" });
  const [migratedHashView, setMigratedHashView] = useState<SettingsView | null>(null);
  const [hasCheckedHash, setHasCheckedHash] = useState(false);
  const activeView = isSettingsView(search.view) ? search.view : (migratedHashView ?? "account");

  useEffect(() => {
    if (hasCheckedHash) return;
    setHasCheckedHash(true);
    const hash = window.location.hash.replace("#", "");
    if (isSettingsView(hash)) {
      setMigratedHashView(hash);
      void navigate({ search: { view: hash }, replace: true });
    }
  }, [hasCheckedHash, navigate]);

  const navigateToView = (view: SettingsView) => {
    void navigate({ search: { view } });
  };

  return {
    activeView,
    navigateToView,
    ownerHandle: typeof search.ownerHandle === "string" ? search.ownerHandle : undefined,
  };
}

function formatShortDate(value: number) {
  try {
    return new Date(value).toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function normalizeSettingsHandle(handle: string | null | undefined) {
  return handle?.trim().replace(/^@+/, "").toLowerCase() ?? "";
}
