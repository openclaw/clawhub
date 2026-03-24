import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { gravatarUrl } from "../lib/gravatar";

export const Route = createFileRoute("/settings")({
  component: Settings,
});

function Settings() {
  const me = useQuery(api.users.me);
  const updateProfile = useMutation(api.users.updateProfile);
  const deleteAccount = useMutation(api.users.deleteAccount);
  const tokens = useQuery(api.tokens.listMine) as
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
  const [status, setStatus] = useState<string | null>(null);
  const [tokenLabel, setTokenLabel] = useState("CLI token");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [orgHandle, setOrgHandle] = useState("");
  const [orgDisplayName, setOrgDisplayName] = useState("");
  const [selectedOrgHandle, setSelectedOrgHandle] = useState("");
  const [memberHandle, setMemberHandle] = useState("");
  const [memberRole, setMemberRole] = useState<"owner" | "admin" | "publisher">("publisher");
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
      <main className="section">
        <div className="card">Sign in to access settings.</div>
      </main>
    );
  }

  const avatar = me.image ?? (me.email ? gravatarUrl(me.email, 160) : undefined);
  const identityName = me.displayName ?? me.name ?? me.handle ?? "Profile";
  const handle = me.handle ?? (me.email ? me.email.split("@")[0] : undefined);

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    await updateProfile({ displayName, bio });
    setStatus("Saved.");
  }

  async function onDelete() {
    const ok = window.confirm(
      "Delete your account permanently? This cannot be undone.\n\n" +
        "Published skills will remain public.",
    );
    if (!ok) return;
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
    <main className="section settings-shell">
      <h1 className="section-title">Settings</h1>
      <div className="card settings-profile">
        <div className="settings-avatar">
          {avatar ? (
            <img src={avatar} alt={identityName} />
          ) : (
            <span>{identityName[0]?.toUpperCase() ?? "U"}</span>
          )}
        </div>
        <div className="settings-profile-body">
          <div className="settings-name">{identityName}</div>
          {handle ? <div className="settings-handle">@{handle}</div> : null}
          {me.email ? <div className="settings-email">{me.email}</div> : null}
        </div>
      </div>
      <form className="card settings-card" onSubmit={onSave}>
        <label className="settings-field">
          <span>Display name</span>
          <input
            className="settings-input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="settings-field">
          <span>Bio</span>
          <textarea
            className="settings-input"
            rows={5}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            placeholder="Tell people what you're building."
          />
        </label>
        <div className="settings-actions">
          <button className="btn btn-primary settings-save" type="submit">
            Save
          </button>
          {status ? <div className="stat">{status}</div> : null}
        </div>
      </form>

      <div className="card settings-card">
        <h2 className="section-title" style={{ marginTop: 0 }}>
          Organizations
        </h2>
        <p className="section-subtitle">
          Create org publishers and manage who can publish under them.
        </p>

        <div className="settings-field">
          <span>Org handle</span>
          <input
            className="settings-input"
            value={orgHandle}
            onChange={(event) => setOrgHandle(event.target.value)}
            placeholder="openclaw"
          />
        </div>
        <div className="settings-field">
          <span>Display name</span>
          <input
            className="settings-input"
            value={orgDisplayName}
            onChange={(event) => setOrgDisplayName(event.target.value)}
            placeholder="OpenClaw"
          />
        </div>
        <div className="settings-actions">
          <button
            className="btn btn-primary settings-save"
            type="button"
            disabled={!orgHandle.trim()}
            onClick={() => void onCreateOrg()}
          >
            Create org
          </button>
        </div>

        {orgs.length > 0 ? (
          <>
            <div className="settings-field" style={{ marginTop: 16 }}>
              <span>Manage org</span>
              <select
                className="settings-input"
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
                <div className="settings-field">
                  <span>Add member</span>
                  <input
                    className="settings-input"
                    value={memberHandle}
                    onChange={(event) => setMemberHandle(event.target.value)}
                    placeholder="@username"
                  />
                </div>
                <div className="settings-field">
                  <span>Role</span>
                  <select
                    className="settings-input"
                    value={memberRole}
                    onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}
                  >
                    <option value="publisher">Publisher</option>
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                </div>
                <div className="settings-actions">
                  <button
                    className="btn"
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
                  </button>
                </div>
              </>
            ) : null}

            {(orgMembers?.members ?? []).length ? (
              <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
                {orgMembers?.members.map((entry) => (
                  <div
                    key={`${entry.user._id}:${entry.role}`}
                    className="stat"
                    style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                  >
                    <div>
                      <strong>{entry.user.displayName ?? entry.user.handle ?? entry.user._id}</strong>
                      <div style={{ opacity: 0.7 }}>
                        @{entry.user.handle ?? "user"} · {entry.role}
                      </div>
                    </div>
                    {selectedOrg && selectedOrg.role !== "publisher" ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() =>
                          void removeOrgMember({
                            publisherId: selectedOrg.publisher._id,
                            userId: entry.user._id,
                          })
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="card settings-card">
        <h2 className="section-title danger-title" style={{ marginTop: 0 }}>
          API tokens
        </h2>
        <p className="section-subtitle">
          Use these tokens for the `clawhub` CLI. Tokens are shown once on creation.
        </p>

        <div className="settings-field">
          <span>Label</span>
          <input
            className="settings-input"
            value={tokenLabel}
            onChange={(event) => setTokenLabel(event.target.value)}
            placeholder="CLI token"
          />
        </div>
        <div className="settings-actions">
          <button
            className="btn btn-primary settings-save"
            type="button"
            onClick={() => void onCreateToken()}
          >
            Create token
          </button>
          {newToken ? (
            <div className="stat" style={{ overflowX: "auto" }}>
              <div style={{ marginBottom: 8 }}>Copy this token now:</div>
              <code>{newToken}</code>
            </div>
          ) : null}
        </div>

        {(tokens ?? []).length ? (
          <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
            {(tokens ?? []).map((token) => (
              <div
                key={token._id}
                className="stat"
                style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
              >
                <div>
                  <div>
                    <strong>{token.label}</strong>{" "}
                    <span style={{ opacity: 0.7 }}>({token.prefix}…)</span>
                  </div>
                  <div style={{ opacity: 0.7 }}>
                    Created {formatDate(token.createdAt)}
                    {token.lastUsedAt ? ` · Used ${formatDate(token.lastUsedAt)}` : ""}
                    {token.revokedAt ? ` · Revoked ${formatDate(token.revokedAt)}` : ""}
                  </div>
                </div>
                <div>
                  <button
                    className="btn"
                    type="button"
                    disabled={Boolean(token.revokedAt)}
                    onClick={() => void revokeToken({ tokenId: token._id })}
                  >
                    {token.revokedAt ? "Revoked" : "Revoke"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="section-subtitle" style={{ marginTop: 16 }}>
            No tokens yet.
          </p>
        )}
      </div>

      <div className="card danger-card">
        <h2 className="section-title danger-title">Danger zone</h2>
        <p className="section-subtitle">
          Delete your account permanently. This cannot be undone. Published skills remain public.
        </p>
        <button className="btn btn-danger" type="button" onClick={() => void onDelete()}>
          Delete account
        </button>
      </div>
    </main>
  );
}

function formatDate(value: number) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}
