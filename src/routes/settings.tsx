import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Container } from "../components/layout/Container";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { SignInButton } from "../components/SignInButton";
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
import { Separator } from "../components/ui/separator";
import { Textarea } from "../components/ui/textarea";
import { gravatarUrl } from "../lib/gravatar";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

export function Settings() {
  const me = useQuery(api.users.me);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const tokens = useQuery(api.tokens.listMine, me ? {} : "skip") as
    | Array<{
        _id: Id<"apiTokens">;
        label: string;
        prefix: string;
        createdAt: number;
        lastUsedAt?: number;
        revokedAt?: number;
      }>
    | undefined;
  const createToken = useMutation(api.tokens.create);
  const revokeToken = useMutation(api.tokens.revoke);
  const publisherMemberships = useQuery(api.publishers.listMine) as
    | Array<{
        publisher: {
          _id: Id<"publishers">;
          handle: string;
          displayName: string;
          kind: "user" | "org";
        };
        role: "owner" | "admin" | "publisher";
      }>
    | undefined;
  const createOrg = useMutation(api.publishers.createOrg);
  const addOrgMember = useMutation(api.publishers.addMember);
  const removeOrgMember = useMutation(api.publishers.removeMember);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [tokenLabel, setTokenLabel] = useState("CLI token");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [orgHandle, setOrgHandle] = useState("");
  const [orgDisplayName, setOrgDisplayName] = useState("");
  const [selectedOrgHandle, setSelectedOrgHandle] = useState("");
  const [memberHandle, setMemberHandle] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "admin" | "publisher">("publisher");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const orgs = (publisherMemberships ?? []).filter((entry) => entry.publisher.kind === "org");
  const selectedOrg =
    orgs.find((entry) => entry.publisher.handle === selectedOrgHandle) ?? orgs[0] ?? null;
  const orgMembers = useQuery(
    api.publishers.listMembers,
    selectedOrg ? { publisherHandle: selectedOrg.publisher.handle } : "skip",
  ) as
    | {
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
      }
    | null
    | undefined;

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

  if (!me) {
    return (
      <Container size="narrow" className="py-10">
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <span>Sign in to access settings.</span>
            <SignInButton variant="outline">Sign in with GitHub</SignInButton>
          </CardContent>
        </Card>
      </Container>
    );
  }

  const avatar = me.image ?? (me.email ? gravatarUrl(me.email, 160) : undefined);
  const identityName = me.displayName ?? me.name ?? me.handle ?? "Profile";
  const handle = me.handle ?? (me.email ? me.email.split("@")[0] : undefined);

  async function onSave(event: React.FormEvent) {
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
    }
  }

  return (
    <Container size="narrow" className="py-10">
      <main className="flex flex-col gap-6">
        <h1 className="font-display text-2xl font-bold text-[color:var(--ink)]">Settings</h1>

        {/* Profile card */}
        <Card>
          <CardContent className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              {avatar ? <AvatarImage src={avatar} alt={identityName} /> : null}
              <AvatarFallback className="text-lg">
                {identityName[0]?.toUpperCase() ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-0.5">
              <div className="text-lg font-bold text-[color:var(--ink)]">{identityName}</div>
              {handle ? (
                <div className="text-sm text-[color:var(--ink-soft)]">@{handle}</div>
              ) : null}
              {me.email ? (
                <div className="text-sm text-[color:var(--ink-soft)]">{me.email}</div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {/* Edit profile form */}
        <Card>
          <form className="flex flex-col gap-4" onSubmit={onSave}>
            <CardContent>
              <div className="flex flex-col gap-2">
                <Label htmlFor="settings-display-name">Display name</Label>
                <Input
                  id="settings-display-name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="settings-bio">Bio</Label>
                <Textarea
                  id="settings-bio"
                  rows={5}
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="Tell people what you're building."
                />
              </div>
            </CardContent>
            <div className="flex items-center gap-3 px-[22px] pb-[22px]">
              <Button variant="primary" type="submit">
                Save
              </Button>
            </div>
          </form>
        </Card>

        {/* Organizations */}
        <Card>
          <CardHeader>
            <CardTitle>Organizations</CardTitle>
            <CardDescription>
              Create org publishers and manage who can publish under them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-org-handle">Org handle</Label>
              <Input
                id="settings-org-handle"
                value={orgHandle}
                onChange={(event) => setOrgHandle(event.target.value)}
                placeholder="openclaw"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-org-display-name">Display name</Label>
              <Input
                id="settings-org-display-name"
                value={orgDisplayName}
                onChange={(event) => setOrgDisplayName(event.target.value)}
                placeholder="OpenClaw"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                type="button"
                disabled={!orgHandle.trim()}
                onClick={() => void onCreateOrg()}
              >
                Create org
              </Button>
            </div>

            {orgs.length > 0 ? (
              <>
                <Separator className="my-2" />

                <div className="flex flex-col gap-2">
                  <Label htmlFor="settings-manage-org">Manage org</Label>
                  <select
                    id="settings-manage-org"
                    className="w-full min-h-[44px] rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 py-[13px] text-[color:var(--ink)] transition-all duration-[180ms] ease-out focus:outline-none focus:border-[color-mix(in_srgb,var(--accent)_70%,white)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
                    value={selectedOrg?.publisher.handle ?? ""}
                    onChange={(event) => setSelectedOrgHandle(event.target.value)}
                  >
                    {orgs.map((entry) => (
                      <option key={entry.publisher._id} value={entry.publisher.handle}>
                        @{entry.publisher.handle} · {entry.role}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedOrg && selectedOrg.role !== "publisher" ? (
                  <>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="settings-add-member">Add member</Label>
                      <Input
                        id="settings-add-member"
                        value={memberHandle}
                        onChange={(event) => setMemberHandle(event.target.value)}
                        placeholder="@username"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="settings-member-role">Role</Label>
                      <select
                        id="settings-member-role"
                        className="w-full min-h-[44px] rounded-[var(--radius-sm)] border border-[rgba(29,59,78,0.22)] bg-[rgba(255,255,255,0.94)] px-3.5 py-[13px] text-[color:var(--ink)] transition-all duration-[180ms] ease-out focus:outline-none focus:border-[color-mix(in_srgb,var(--accent)_70%,white)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_22%,transparent)] dark:border-[rgba(255,255,255,0.12)] dark:bg-[rgba(14,28,37,0.84)]"
                        value={memberRole}
                        onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}
                      >
                        <option value="publisher">Publisher</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        disabled={!memberHandle.trim()}
                        onClick={() =>
                          void addOrgMember({
                            publisherId: selectedOrg.publisher._id,
                            userHandle: memberHandle,
                            role: memberRole,
                          }).then(() => setMemberHandle(""))
                        }
                      >
                        Add member
                      </Button>
                    </div>
                  </>
                ) : null}

                {(orgMembers?.members ?? []).length ? (
                  <div className="grid gap-2.5 mt-2">
                    {orgMembers?.members.map((entry) => (
                      <div
                        key={`${entry.user._id}:${entry.role}`}
                        className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-3"
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-[color:var(--ink)]">
                            {entry.user.displayName ?? entry.user.handle ?? entry.user._id}
                          </span>
                          <span className="text-sm text-[color:var(--ink-soft)]">
                            @{entry.user.handle ?? "user"} · {entry.role}
                          </span>
                        </div>
                        {selectedOrg && selectedOrg.role !== "publisher" ? (
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
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>

        {/* API tokens */}
        <Card>
          <CardHeader>
            <CardTitle>API tokens</CardTitle>
            <CardDescription>
              Use these tokens for the `clawhub` CLI. Tokens are shown once on creation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              <Label htmlFor="settings-token-label">Label</Label>
              <Input
                id="settings-token-label"
                value={tokenLabel}
                onChange={(event) => setTokenLabel(event.target.value)}
                placeholder="CLI token"
              />
            </div>
            <div className="flex flex-col items-start gap-3">
              <Button variant="primary" type="button" onClick={() => void onCreateToken()}>
                Create token
              </Button>
              {newToken ? (
                <div className="w-full rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-4">
                  <div className="mb-2 text-sm font-semibold text-[color:var(--ink)]">
                    Copy this token now:
                  </div>
                  <code className="block break-all text-sm text-[color:var(--ink-soft)]">
                    {newToken}
                  </code>
                </div>
              ) : null}
            </div>

            {(tokens ?? []).length ? (
              <div className="grid gap-2.5 mt-2">
                {(tokens ?? []).map((token) => (
                  <div
                    key={token._id}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] px-4 py-3"
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[color:var(--ink)]">{token.label}</span>
                        <span className="text-sm text-[color:var(--ink-soft)]">
                          ({token.prefix}...)
                        </span>
                        {token.revokedAt ? <Badge variant="destructive">Revoked</Badge> : null}
                      </div>
                      <span className="text-sm text-[color:var(--ink-soft)]">
                        Created {formatDate(token.createdAt)}
                        {token.lastUsedAt ? ` · Used ${formatDate(token.lastUsedAt)}` : ""}
                        {token.revokedAt ? ` · Revoked ${formatDate(token.revokedAt)}` : ""}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      disabled={Boolean(token.revokedAt)}
                      onClick={() => void revokeToken({ tokenId: token._id })}
                    >
                      {token.revokedAt ? "Revoked" : "Revoke"}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-[color:var(--ink-soft)]">No tokens yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Danger zone */}
        <Card className="border-red-300/40 dark:border-red-500/30">
          <CardHeader>
            <CardTitle className="text-red-700 dark:text-red-300">Danger zone</CardTitle>
            <CardDescription>
              Delete your account permanently. This cannot be undone. Published skills remain
              public.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive" type="button">
                  Delete account
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete account</DialogTitle>
                  <DialogDescription>
                    Delete your account permanently? This cannot be undone. Published skills will
                    remain public.
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
          </CardContent>
        </Card>
      </main>
    </Container>
  );
}

function formatDate(value: number) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}
