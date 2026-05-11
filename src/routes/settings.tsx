import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  CircleX,
  Code,
  Copy,
  KeyRound,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Plus,
  Save,
  ShieldAlert,
  Sun,
  Trash2,
  type LucideIcon,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EmptyState } from "../components/EmptyState";
import { copyText } from "../components/InstallCopyButton";
import { MarketplaceIcon } from "../components/MarketplaceIcon";
import { SignInButton } from "../components/SignInButton";
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
import { useThemeMode } from "../lib/theme";

const settingsViews = ["account", "organizations", "tokens", "danger"] as const;
type SettingsView = (typeof settingsViews)[number];

function isSettingsView(value: unknown): value is SettingsView {
  return typeof value === "string" && settingsViews.includes(value as SettingsView);
}

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { view?: SettingsView } => ({
    view: isSettingsView(search.view) ? search.view : undefined,
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
    bio?: string | null;
  };
  role: "owner" | "admin" | "publisher";
};

type OrgMembersResult = {
  publisher: { _id: Id<"publishers">; handle: string } | null;
  members: Array<{
    role: "owner" | "admin" | "publisher";
    user: {
      _id: Id<"users">;
      handle: string | null;
      displayName: string | null;
      image: string | null;
    };
  }>;
};

const navigationGroups: Array<{
  items: Array<{ view: SettingsView; label: string; mobileLabel: string; icon: LucideIcon }>;
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
const themeToggleItemClass =
  "!h-20 min-w-0 flex-1 flex-col gap-2 !rounded-[var(--r-btn)] border border-[color:var(--line)] bg-[color:var(--surface)] px-3 text-sm font-semibold text-[color:var(--ink-soft)] opacity-70 hover:border-[color:var(--border-ui-hover)] hover:bg-[color:var(--surface-muted)] hover:text-[color:var(--ink)] hover:opacity-100 data-[state=on]:border-[color:var(--accent)] data-[state=on]:!bg-[color:var(--surface-muted)] data-[state=on]:text-[color:var(--ink)] data-[state=on]:opacity-100 sm:!w-28 sm:flex-none";

export function Settings() {
  const me = useQuery(api.users.me);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const tokens = useQuery(api.tokens.listMine, me ? {} : "skip") as Array<ApiToken> | undefined;
  const createToken = useMutation(api.tokens.create);
  const revokeToken = useMutation(api.tokens.revoke);
  const publisherMemberships = useQuery(api.publishers.listMine) as
    | Array<PublisherMembership>
    | undefined;
  const createOrg = useMutation(api.publishers.createOrg);
  const updateOrgProfile = useMutation(api.publishers.updateProfile);
  const addOrgMember = useMutation(api.publishers.addMember);
  const removeOrgMember = useMutation(api.publishers.removeMember);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [tokenLabel, setTokenLabel] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [orgHandle, setOrgHandle] = useState("");
  const [orgDisplayName, setOrgDisplayName] = useState("");
  const [selectedOrgHandle, setSelectedOrgHandle] = useState("");
  const [selectedOrgDisplayName, setSelectedOrgDisplayName] = useState("");
  const [selectedOrgBio, setSelectedOrgBio] = useState("");
  const [selectedOrgImage, setSelectedOrgImage] = useState("");
  const [memberHandle, setMemberHandle] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "admin" | "publisher">("publisher");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [createOrgDialogOpen, setCreateOrgDialogOpen] = useState(false);
  const [addMemberDialogOpen, setAddMemberDialogOpen] = useState(false);
  const [revokeTokenId, setRevokeTokenId] = useState<Id<"apiTokens"> | null>(null);
  const { activeView, navigateToView } = useActiveSettingsView();
  const orgs = (publisherMemberships ?? []).filter((entry) => entry.publisher.kind === "org");
  const selectedOrg =
    orgs.find((entry) => entry.publisher.handle === selectedOrgHandle) ?? orgs[0] ?? null;
  const hasOrgProfileChanges = selectedOrg
    ? selectedOrgDisplayName !== (selectedOrg.publisher.displayName ?? "") ||
      selectedOrgBio !== (selectedOrg.publisher.bio ?? "") ||
      selectedOrgImage !== (selectedOrg.publisher.image ?? "")
    : false;
  const hasProfileChanges = me
    ? displayName !== (me.displayName ?? "") || bio !== (me.bio ?? "")
    : false;
  const activeTokens = (tokens ?? []).filter((token) => !token.revokedAt);
  const revokedTokens = (tokens ?? []).filter((token) => token.revokedAt);
  const orgMembers = useQuery(
    api.publishers.listMembers,
    activeView === "organizations" && selectedOrg
      ? { publisherHandle: selectedOrg.publisher.handle }
      : "skip",
  ) as OrgMembersResult | null | undefined;

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
    if (!selectedOrg) {
      setSelectedOrgDisplayName("");
      setSelectedOrgBio("");
      setSelectedOrgImage("");
      return;
    }
    setSelectedOrgDisplayName(selectedOrg.publisher.displayName ?? "");
    setSelectedOrgBio(selectedOrg.publisher.bio ?? "");
    setSelectedOrgImage(selectedOrg.publisher.image ?? "");
  }, [selectedOrg]);

  if (!me) {
    return (
      <main
        className="relative mx-auto flex min-h-[430px] w-full flex-col overflow-hidden px-4 pb-12 pt-20 sm:px-6 sm:pt-24 lg:px-6"
        style={{ maxWidth: "var(--page-max)" }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 inset-x-10 h-64"
          style={{
            background:
              "linear-gradient(to bottom, color-mix(in srgb, var(--accent) 22%, transparent), color-mix(in srgb, var(--accent) 5%, transparent) 42%, transparent 74%)",
            filter: "blur(2px)",
            maskImage: "linear-gradient(to right, transparent, black 22%, black 78%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent, black 22%, black 78%, transparent)",
          }}
        />
        <section className="relative z-10 mx-auto w-full max-w-[980px]">
          <div className="relative isolate flex min-w-0 flex-col gap-6 overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)] px-5 pb-10 pt-7 shadow-[0_18px_50px_rgba(0,0,0,0.16)] sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-8 sm:pb-10">
            <div className="min-w-0">
              <span className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink-soft)] sm:h-12 sm:w-12">
                <LockKeyhole size={21} />
              </span>
              <h1 className="font-display text-xl font-black leading-tight text-[color:var(--ink)] sm:text-3xl">
                Sign in to access settings
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[color:var(--ink-soft)] sm:text-base sm:leading-7">
                Manage your profile, organizations, and API access.
              </p>
            </div>
            <SignInButton
              size="sm"
              className="min-h-10 w-full shrink-0 border-[color-mix(in_srgb,var(--accent)_82%,var(--border-ui))] bg-transparent px-4 text-sm text-[color:var(--ink)] hover:not-disabled:border-[color:var(--accent)] hover:not-disabled:bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] sm:w-auto"
            >
              <SettingsGitHubLogo className="h-4 w-4" />
              Sign in with GitHub
            </SignInButton>
          </div>
        </section>
      </main>
    );
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
    await deleteAccount();
  }

  async function onCreateToken() {
    const label = tokenLabel.trim() || "CLI token";
    const result = await createToken({ label });
    setNewToken(result.token);
    setTokenLabel("");
  }

  async function onCreateOrg() {
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
    }
  }

  async function onSaveOrgProfile() {
    if (!selectedOrg) return;
    await updateOrgProfile({
      publisherId: selectedOrg.publisher._id,
      displayName: selectedOrgDisplayName,
      bio: selectedOrgBio || undefined,
      image: selectedOrgImage || undefined,
    });
    toast.success("Organization updated");
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
                      const active = activeView === item.view;
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
              visible={activeView === "account"}
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
                        <span className="text-sm font-semibold text-red-700 dark:text-red-300">
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
              visible={activeView === "organizations"}
              icon={<Building2 size={18} />}
              title="Organizations"
              description="Publisher profiles and access."
            >
              <div className="flex flex-col gap-5">
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
                      <Dialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
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
                              Create a publisher profile for a team or project.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4">
                            <Field label="Handle" htmlFor="settings-org-handle">
                              <Input
                                id="settings-org-handle"
                                value={orgHandle}
                                onChange={(event) => setOrgHandle(event.target.value)}
                                placeholder="openclaw"
                              />
                            </Field>
                            <Field label="Display name" htmlFor="settings-org-display-name">
                              <Input
                                id="settings-org-display-name"
                                value={orgDisplayName}
                                onChange={(event) => setOrgDisplayName(event.target.value)}
                                placeholder="OpenClaw"
                              />
                            </Field>
                          </div>
                          <DialogFooter>
                            <Button variant="ghost" onClick={() => setCreateOrgDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              type="button"
                              disabled={!orgHandle.trim()}
                              onClick={() => void onCreateOrg()}
                            >
                              <Building2 size={16} />
                              Create org
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
                                image={selectedOrgImage.trim() || undefined}
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
                                  <Field label="Avatar URL" htmlFor="settings-selected-org-image">
                                    <Input
                                      id="settings-selected-org-image"
                                      value={selectedOrgImage}
                                      onChange={(event) => setSelectedOrgImage(event.target.value)}
                                      placeholder="https://example.com/logo.png"
                                    />
                                  </Field>
                                </div>
                                {selectedOrgImage ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label="Clear avatar URL"
                                    className="mt-6 shrink-0"
                                    onClick={() => setSelectedOrgImage("")}
                                  >
                                    <X size={15} />
                                  </Button>
                                ) : null}
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
                                  <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                                    You have unsaved changes.
                                  </span>
                                ) : null}
                                <Button type="button" onClick={() => void onSaveOrgProfile()}>
                                  <Save size={16} />
                                  Save changes
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
                              open={addMemberDialogOpen}
                              onOpenChange={setAddMemberDialogOpen}
                            >
                              <DialogTrigger asChild>
                                <Button
                                  type="button"
                                  className="h-10 w-auto shrink-0 px-3 text-sm sm:h-11 sm:px-4"
                                >
                                  <Users size={16} />
                                  Add member
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Add member</DialogTitle>
                                  <DialogDescription>
                                    Give a user access to @{selectedOrg.publisher.handle}.
                                  </DialogDescription>
                                </DialogHeader>
                                <div className="grid gap-4">
                                  <Field label="User handle" htmlFor="settings-add-member">
                                    <Input
                                      id="settings-add-member"
                                      value={memberHandle}
                                      onChange={(event) => setMemberHandle(event.target.value)}
                                      placeholder="@username"
                                    />
                                  </Field>
                                  <Field label="Role" htmlFor="settings-member-role">
                                    <Select
                                      value={memberRole}
                                      onValueChange={(value) =>
                                        setMemberRole(value as "owner" | "admin" | "publisher")
                                      }
                                    >
                                      <SelectTrigger id="settings-member-role">
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="publisher">Publisher</SelectItem>
                                        <SelectItem value="admin">Admin</SelectItem>
                                        <SelectItem value="owner">Owner</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </Field>
                                </div>
                                <DialogFooter>
                                  <Button
                                    variant="ghost"
                                    onClick={() => setAddMemberDialogOpen(false)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    type="button"
                                    disabled={!memberHandle.trim()}
                                    onClick={() =>
                                      void addOrgMember({
                                        publisherId: selectedOrg.publisher._id,
                                        userHandle: memberHandle,
                                        role: memberRole,
                                      }).then(() => {
                                        setMemberHandle("");
                                        setAddMemberDialogOpen(false);
                                      })
                                    }
                                  >
                                    <Users size={16} />
                                    Add member
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
                            Add a publisher profile for a team or project.
                          </p>
                        </div>
                      </div>
                      <Dialog open={createOrgDialogOpen} onOpenChange={setCreateOrgDialogOpen}>
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
                              Create a publisher profile for a team or project.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="grid gap-4">
                            <Field label="Handle" htmlFor="settings-org-handle-empty">
                              <Input
                                id="settings-org-handle-empty"
                                value={orgHandle}
                                onChange={(event) => setOrgHandle(event.target.value)}
                                placeholder="openclaw"
                              />
                            </Field>
                            <Field label="Display name" htmlFor="settings-org-display-name-empty">
                              <Input
                                id="settings-org-display-name-empty"
                                value={orgDisplayName}
                                onChange={(event) => setOrgDisplayName(event.target.value)}
                                placeholder="OpenClaw"
                              />
                            </Field>
                          </div>
                          <DialogFooter>
                            <Button variant="ghost" onClick={() => setCreateOrgDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              type="button"
                              disabled={!orgHandle.trim()}
                              onClick={() => void onCreateOrg()}
                            >
                              <Building2 size={16} />
                              Create org
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
              id="tokens"
              visible={activeView === "tokens"}
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
                  <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-amber-300/30 bg-amber-500/[0.06] p-4 dark:border-amber-500/25 dark:bg-amber-500/[0.08]">
                    <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
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
              visible={activeView === "danger"}
              icon={<ShieldAlert size={18} />}
              title="Account deletion"
              description="Delete your account permanently. Published skills remain public."
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
                            Delete your account permanently? This cannot be undone. Published skills
                            will remain public.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button variant="destructive" onClick={() => void onDelete()}>
                            Delete account
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>

                  <div className="flex items-start gap-3 rounded-[var(--radius-sm)] border border-red-300/20 bg-red-500/[0.04] p-4 dark:border-red-500/20 dark:bg-red-500/[0.06]">
                    <ShieldAlert
                      size={18}
                      className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
                    />
                    <div className="flex flex-col gap-1">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                        This will permanently delete your account
                      </p>
                      <p className="text-sm text-[color:var(--ink-soft)]">
                        Your profile, starred skills, and API tokens will be removed. Published
                        skills will remain public and accessible to the community.
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
                    ? "border-red-300/40 bg-red-500/10 text-red-700 dark:border-red-500/30 dark:text-red-300"
                    : "border-[color:var(--line)] bg-[color:var(--surface-muted)] text-[color:var(--ink)]"
                }`}
              >
                {icon}
              </span>
              <div className="min-w-0">
                <h2
                  className={`font-display text-2xl font-black leading-none ${
                    tone === "danger" ? "text-red-700 dark:text-red-300" : "text-[color:var(--ink)]"
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
          ? "border-red-300/50 bg-red-500/[0.035] dark:border-red-500/35 dark:bg-red-500/[0.045]"
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
                      <CircleX size={16} aria-hidden="true" className="shrink-0 text-red-500" />
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
                      className="h-8 gap-2 px-0 text-xs text-red-700 hover:bg-transparent hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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
                <CircleX size={16} aria-hidden="true" className="shrink-0 text-red-500" />
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
                  className="h-8 gap-2 px-0 text-xs text-red-700 hover:bg-transparent hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
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

  return { activeView, navigateToView };
}

function SettingsGitHubLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.16 1.18.92-.26 1.9-.38 2.88-.39.98 0 1.96.13 2.88.39 2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.75.12 3.04.74.8 1.18 1.83 1.18 3.08 0 4.42-2.69 5.39-5.25 5.67.42.36.78 1.07.78 2.15 0 1.55-.01 2.8-.01 3.18 0 .31.21.67.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
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
