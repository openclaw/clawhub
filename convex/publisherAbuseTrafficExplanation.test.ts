/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import {
  createPublisherAbuseTrafficExplanationToken,
  matchesPublisherAbuseTrafficExplanationToken,
  truncatePublisherAbuseResponsePreview,
} from "./lib/publisherAbuseTrafficExplanation";

vi.mock("./functions", () => ({
  internalMutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  internalQuery: (def: { handler: unknown }) => ({ _handler: def.handler }),
  mutation: (def: { handler: unknown }) => ({ _handler: def.handler }),
  query: (def: { handler: unknown }) => ({ _handler: def.handler }),
}));

vi.mock("./lib/access", () => ({
  requireUser: vi.fn(),
}));

const trafficExplanation = await import("./publisherAbuseTrafficExplanation");
const VALID_TOKEN = "a".repeat(64);
const VALID_TOKEN_HASH = "ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb";
const { requireUser } = await import("./lib/access");

type Handler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;
type Wrapped<TArgs, TResult> = { _handler: Handler<TArgs, TResult> };

const getForOwnerHandler = (
  trafficExplanation.getForOwner as unknown as Wrapped<
    { signalId: string; token: string },
    {
      skillDisplayName: string;
      response: unknown;
    } | null
  >
)._handler;

const submitHandler = (
  trafficExplanation.submit as unknown as Wrapped<
    {
      signalId: string;
      token: string;
      kind: "expected" | "not_recognized" | "unsure";
      message?: string;
    },
    { ok: true; submittedAt: number }
  >
)._handler;

const beginDeliveryAttemptHandler = (
  trafficExplanation.beginDeliveryAttemptInternal as unknown as Wrapped<
    {
      signalId: string;
      requestedAt: number;
      attemptedAt: number;
      expectedAttemptCount: number;
      tokenHash: string;
      recipientUserId: string;
      recipientEmail: string;
      subject: string;
      templateVersion: string;
      reasonBullets: string[];
      redactedTextSnapshot: string;
    },
    { ok: boolean; attemptCount?: number; reason?: string }
  >
)._handler;

const recordDeliveryHandler = (
  trafficExplanation.recordDeliveryInternal as unknown as Wrapped<
    {
      signalId: string;
      requestedAt: number;
      delivery:
        | { status: "sent"; sentAt: number; providerId: string | null }
        | {
            status: "retrying" | "cancelled" | "not_deliverable";
            recordedAt: number;
            reason: string;
          };
    },
    { ok: boolean; attemptCount?: number }
  >
)._handler;

function makeFixture({ response }: { response?: Record<string, unknown> } = {}) {
  const owner = {
    _id: "users:owner" as Id<"users">,
    _creationTime: 1,
    handle: "owner",
    email: "owner@example.com",
    role: "user" as const,
  } satisfies Doc<"users">;
  const publisher = {
    _id: "publishers:owner",
    kind: "user",
    handle: "owner",
    linkedUserId: owner._id,
  };
  const skill = {
    _id: "skills:popular",
    slug: "popular",
    displayName: "Popular Skill",
    ownerUserId: owner._id,
    ownerPublisherId: publisher._id,
  };
  const signal = {
    _id: "publisherAbuseSignals:traffic",
    signalType: "download_spike_flat_installs",
    skillId: skill._id,
    ownerUserId: owner._id,
    ownerPublisherId: publisher._id,
    skillSlug: skill.slug,
    skillDisplayName: skill.displayName,
    handleSnapshot: publisher.handle,
    recent30Downloads: 330_000,
    reviewStatus: "open",
    trafficExplanationRequest: {
      requestedAt: 1_700_000_000_000,
      tokenHash: VALID_TOKEN_HASH,
    },
    ...(response ? { trafficExplanationResponse: response } : {}),
  };
  const documents = new Map<string, Record<string, unknown>>([
    [owner._id, owner],
    [publisher._id, publisher],
    [skill._id, skill],
    [signal._id, signal],
  ]);
  const patch = vi.fn(async () => null);
  const insert = vi.fn(async () => "auditLogs:1");
  const scheduler = { runAfter: vi.fn(async () => null) };
  const ctx = {
    db: {
      normalizeId: vi.fn((_table: string, id: string) =>
        id.startsWith("publisherAbuseSignals:") ? id : null,
      ),
      get: vi.fn(async (id: string) => documents.get(id) ?? null),
      patch,
      insert,
    },
    scheduler,
  };
  return { ctx, documents, insert, owner, patch, scheduler, signal, skill };
}

function makeLegacyPersonalFixture() {
  const fixture = makeFixture();
  const legacySkill = {
    _id: "skills:legacy",
    slug: "legacy",
    displayName: "Legacy Skill",
    ownerUserId: fixture.owner._id,
  };
  const legacySignal = {
    ...fixture.signal,
    _id: "publisherAbuseSignals:legacy",
    skillId: legacySkill._id,
    skillSlug: legacySkill.slug,
    skillDisplayName: legacySkill.displayName,
    ownerPublisherId: undefined,
  };
  fixture.ctx.db.get.mockImplementation(async (id: string) => {
    if (id === legacySkill._id) return legacySkill;
    if (id === legacySignal._id) return legacySignal;
    if (id === fixture.owner._id) return fixture.owner;
    return null;
  });
  return { ...fixture, legacySignal };
}

describe("publisher abuse traffic explanations", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockReset();
  });

  it("shows an issued request to the current personal publisher owner", async () => {
    const { ctx, owner } = makeFixture();
    vi.mocked(requireUser).mockResolvedValue({ userId: owner._id, user: owner });

    await expect(
      getForOwnerHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
      }),
    ).resolves.toMatchObject({
      scope: "skill",
      skillDisplayName: "Popular Skill",
      response: null,
    });
  });

  it("presents a synchronized portfolio request at publisher scope", async () => {
    const { ctx, documents, owner, signal } = makeFixture();
    documents.set(signal._id, {
      ...signal,
      signalType: "owner_synchronized_download_trends",
      portfolioEvidence: {
        skillCount: 23,
        publisherSkillCount: 23,
        allPublisherSkills: true,
      },
    });
    vi.mocked(requireUser).mockResolvedValue({ userId: owner._id, user: owner });

    await expect(
      getForOwnerHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
      }),
    ).resolves.toMatchObject({
      scope: "publisher",
      publisherHandle: "owner",
      allPublisherSkills: true,
    });
  });

  it("recognizes legacy personal ownership when publisher ids are absent", async () => {
    const { ctx, legacySignal, owner } = makeLegacyPersonalFixture();
    vi.mocked(requireUser).mockResolvedValue({ userId: owner._id, user: owner });

    await expect(
      getForOwnerHandler(ctx, { signalId: legacySignal._id, token: VALID_TOKEN }),
    ).resolves.toMatchObject({
      skillDisplayName: "Legacy Skill",
      response: null,
    });
  });

  it("stores one trimmed response and audits only its structured kind", async () => {
    const { ctx, insert, owner, patch, scheduler } = makeFixture();
    vi.mocked(requireUser).mockResolvedValue({ userId: owner._id, user: owner });
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_100_000);

    await expect(
      submitHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
        kind: "expected",
        message: "  Shared in our newsletter.  ",
      }),
    ).resolves.toEqual({ ok: true, submittedAt: 1_700_000_100_000 });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseSignals:traffic",
      expect.objectContaining({
        trafficExplanationResponse: {
          kind: "expected",
          message: "Shared in our newsletter.",
          submittedAt: 1_700_000_100_000,
          submittedByUserId: "users:owner",
        },
        needsAttention: true,
        attentionState: "needs_attention",
        notificationEventKind: "publisher_abuse_signal_owner_response_submitted",
        notificationState: "queued",
        needsNotification: true,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher_abuse.signal.traffic_explanation_submitted",
        metadata: {
          skillId: "skills:popular",
          responseKind: "expected",
        },
      }),
    );
    expect(JSON.stringify(insert.mock.calls)).not.toContain("newsletter");
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {});
  });

  it("marks terminal contact failures actionable without retaining the response token", async () => {
    const { ctx, insert, patch, scheduler } = makeFixture();

    await expect(
      recordDeliveryHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        requestedAt: 1_700_000_000_000,
        delivery: {
          status: "not_deliverable",
          recordedAt: 1_700_000_200_000,
          reason: "resend_error",
        },
      }),
    ).resolves.toEqual({ ok: true });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseSignals:traffic",
      expect.objectContaining({
        trafficExplanationRequest: expect.objectContaining({
          state: "not_deliverable",
          tokenHash: undefined,
          deliveryError: "resend_error",
        }),
        contactState: "not_deliverable",
        attentionState: "contact_failed",
        needsAttention: true,
        notificationEventKind: "publisher_abuse_signal_owner_contact_failed",
        notificationState: "queued",
        notificationAttemptCount: 0,
        needsNotification: true,
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "auditLogs",
      expect.objectContaining({
        action: "publisher_abuse.signal.owner_contact_not_deliverable",
        metadata: { attemptCount: 0, reason: "resend_error" },
      }),
    );
    expect(scheduler.runAfter).toHaveBeenCalledWith(0, expect.anything(), {});
    expect(JSON.stringify(patch.mock.calls)).not.toContain(VALID_TOKEN_HASH);
  });

  it("claims one email attempt by storing only the token hash", async () => {
    const { ctx, patch } = makeFixture();

    await expect(
      beginDeliveryAttemptHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        requestedAt: 1_700_000_000_000,
        attemptedAt: 1_700_000_100_000,
        expectedAttemptCount: 0,
        tokenHash: VALID_TOKEN_HASH,
        recipientUserId: "users:owner",
        recipientEmail: "owner@example.com",
        subject: "Question about downloads for Popular Skill",
        templateVersion: "traffic-explanation.v1",
        reasonBullets: ["Downloads rose unusually quickly while installs stayed flat."],
        redactedTextSnapshot: "Hello owner, [SECURE EXPLANATION LINK]",
      }),
    ).resolves.toEqual({ ok: true, attemptCount: 1 });

    expect(patch).toHaveBeenCalledWith(
      "publisherAbuseSignals:traffic",
      expect.objectContaining({
        trafficExplanationRequest: expect.objectContaining({
          tokenHash: VALID_TOKEN_HASH,
          attemptCount: 1,
          redactedTextSnapshot: "Hello owner, [SECURE EXPLANATION LINK]",
        }),
      }),
    );
    expect(JSON.stringify(patch.mock.calls)).not.toContain(VALID_TOKEN);
  });

  it("refuses an email attempt when ownership changed after recipient resolution", async () => {
    const { ctx, documents, patch } = makeFixture();
    documents.set("publishers:owner", {
      _id: "publishers:owner",
      kind: "user",
      handle: "new-owner",
      linkedUserId: "users:new-owner",
    });

    await expect(
      beginDeliveryAttemptHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        requestedAt: 1_700_000_000_000,
        attemptedAt: 1_700_000_100_000,
        expectedAttemptCount: 0,
        tokenHash: VALID_TOKEN_HASH,
        recipientUserId: "users:owner",
        recipientEmail: "owner@example.com",
        subject: "Question about downloads for Popular Skill",
        templateVersion: "traffic-explanation.v1",
        reasonBullets: ["Downloads rose unusually quickly while installs stayed flat."],
        redactedTextSnapshot: "Hello owner, [SECURE EXPLANATION LINK]",
      }),
    ).resolves.toEqual({ ok: false, reason: "owner_changed" });

    expect(patch).not.toHaveBeenCalled();
  });

  it("hides the request from users who do not manage the current publisher", async () => {
    const { ctx } = makeFixture();
    const stranger = {
      _id: "users:stranger" as Id<"users">,
      _creationTime: 1,
      handle: "stranger",
      role: "user" as const,
    } satisfies Doc<"users">;
    vi.mocked(requireUser).mockResolvedValue({ userId: stranger._id, user: stranger });

    await expect(
      getForOwnerHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
      }),
    ).resolves.toBeNull();
    await expect(
      submitHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
        kind: "not_recognized",
      }),
    ).rejects.toThrow("Traffic explanation request not found");
  });

  it("hides the request when the email token is invalid", async () => {
    const { ctx, owner } = makeFixture();
    vi.mocked(requireUser).mockResolvedValue({ userId: owner._id, user: owner });

    await expect(
      getForOwnerHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: "b".repeat(64),
      }),
    ).resolves.toBeNull();
    await expect(
      submitHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: "b".repeat(64),
        kind: "unsure",
      }),
    ).rejects.toThrow("Traffic explanation request not found");
  });

  it("invalidates the request after the skill changes owners", async () => {
    const { ctx, documents, owner, signal, skill } = makeFixture();
    documents.set(skill._id, {
      ...skill,
      ownerUserId: "users:new-owner",
      ownerPublisherId: "publishers:new-owner",
    });
    vi.mocked(requireUser).mockResolvedValue({ userId: owner._id, user: owner });

    await expect(
      getForOwnerHandler(ctx, { signalId: signal._id, token: VALID_TOKEN }),
    ).resolves.toBeNull();
  });

  it("rejects a second response", async () => {
    const { ctx, owner } = makeFixture({
      response: {
        kind: "unsure",
        submittedAt: 1_700_000_100_000,
        submittedByUserId: "users:owner",
      },
    });
    vi.mocked(requireUser).mockResolvedValue({ userId: owner._id, user: owner });

    await expect(
      submitHandler(ctx, {
        signalId: "publisherAbuseSignals:traffic",
        token: VALID_TOKEN,
        kind: "not_recognized",
      }),
    ).rejects.toThrow("A response has already been submitted");
  });
});

describe("publisher abuse traffic explanation primitives", () => {
  it("creates a 256-bit token whose stored hash verifies it", async () => {
    const created = await createPublisherAbuseTrafficExplanationToken();

    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    await expect(
      matchesPublisherAbuseTrafficExplanationToken(created.token, created.tokenHash),
    ).resolves.toBe(true);
    expect(created.tokenHash).not.toBe(created.token);
  });

  it("truncates response previews without splitting a grapheme", () => {
    const prefix = "a".repeat(499);

    expect(truncatePublisherAbuseResponsePreview(`${prefix}👨‍👩‍👧‍👦z`)).toBe(prefix);
  });
});
