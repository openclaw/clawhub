#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  findRecoverableMirrorRun,
  mirrorRateLimitRetryDelayMs,
  mirrorRunAccounting,
  mirrorRunFromPayload,
  reconcileMirrorRunToCompletion,
} from "./prove-mirror-request";

const MAX_STEPS = 2_000;
const MAX_RATE_LIMIT_RETRIES = 30;
const MAX_RATE_LIMIT_WAIT_MS = 30 * 60 * 1_000;
const MAX_TRANSPORT_TIMEOUTS = 3;
const MAX_NATIVE_TRENDING_RECONCILE_POLLS = 360;
const ACTIVATION_RECONCILE_POLL_MS = 5_000;
const MAX_ACTIVATION_RECONCILE_POLLS = 360;

type MirrorRun = Record<string, unknown>;
type SyncFetch = (input: string, init: RequestInit) => Promise<Response>;
type SyncAuthorization = string | (() => Promise<string>);

const OIDC_REFRESH_SKEW_MS = 2 * 60_000;

class UnsafeSkillsShCorpusError extends Error {}

function isTransportTimeout(error: unknown) {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError"
  );
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

function requiredInteger(value: unknown, name: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return Number(value);
}

function optionalRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function jwtExpiresAt(jwt: string) {
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("GitHub OIDC returned a malformed token");
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new Error("GitHub OIDC returned a malformed token");
  }
  const exp = (decoded as { exp?: unknown } | null)?.exp;
  if (typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= 0) {
    throw new Error("GitHub OIDC token is missing a valid expiration");
  }
  return exp * 1_000;
}

export function createGitHubActionsOidcAuthorization(options: {
  requestUrl: string;
  requestToken: string;
  fetchImpl?: SyncFetch;
  now?: () => number;
}) {
  const requestUrl = requiredString(options.requestUrl, "ACTIONS_ID_TOKEN_REQUEST_URL");
  const requestToken = requiredString(options.requestToken, "ACTIONS_ID_TOKEN_REQUEST_TOKEN");
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    const currentTime = now();
    if (cached && currentTime < cached.expiresAt - OIDC_REFRESH_SKEW_MS) return cached.token;
    const separator = requestUrl.includes("?") ? "&" : "?";
    const response = await fetchImpl(`${requestUrl}${separator}audience=clawhub`, {
      headers: { Authorization: `Bearer ${requestToken}` },
    });
    if (!response.ok) {
      throw new Error(`GitHub OIDC token request returned HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { value?: unknown };
    const token = requiredString(payload.value, "GitHub OIDC token");
    cached = { token, expiresAt: jwtExpiresAt(token) };
    return token;
  };
}

export function assertCompletedMirrorRun(run: MirrorRun, sourceView: "leaderboard" | "trending") {
  try {
    if (run.status !== "completed" || (run.sourceView ?? "leaderboard") !== sourceView) {
      throw new Error(`skills.sh ${sourceView} run did not complete`);
    }
    const sourceTotal = requiredInteger(run.sourceTotal, "sourceTotal");
    const counts = run.counts as Record<string, number> | undefined;
    if (!counts) throw new Error(`skills.sh ${sourceView} run lacks counts`);
    if (requiredInteger(counts.observed, "counts.observed") !== sourceTotal) {
      throw new Error(`skills.sh ${sourceView} run did not account for the full source`);
    }
    if (counts.scansPlanned !== 0 || counts.scansAdmitted !== 0) {
      throw new Error(`skills.sh ${sourceView} run scheduled a ClawHub scan`);
    }
    if (sourceView === "leaderboard") {
      const { accepted } = mirrorRunAccounting(sourceTotal, counts);
      if ((counts.inserted ?? 0) + (counts.updated ?? 0) + (counts.unchanged ?? 0) !== accepted) {
        throw new Error("skills.sh leaderboard accepted-row accounting differs");
      }
      if (
        (counts.detailsInserted ?? 0) +
          (counts.detailsUpdated ?? 0) +
          (counts.detailsUnchanged ?? 0) +
          (counts.detailsMissing ?? 0) !==
        accepted
      ) {
        throw new Error("skills.sh leaderboard detail accounting differs");
      }
    } else if ((counts.trendingJoined ?? 0) + (counts.trendingMissing ?? 0) !== sourceTotal) {
      throw new Error("skills.sh Trending accounting differs");
    }
    return run;
  } catch (error) {
    throw new UnsafeSkillsShCorpusError(error instanceof Error ? error.message : String(error));
  }
}

export async function runSkillsShSync(options: {
  targetUrl: string;
  authorization: SyncAuthorization;
  reason: string;
  fetchImpl?: SyncFetch;
  sleep?: (ms: number) => Promise<void>;
}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const callRaw = async (body: Record<string, unknown>) => {
    const authorization =
      typeof options.authorization === "string"
        ? options.authorization
        : await options.authorization();
    const response = await fetchImpl(options.targetUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authorization}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = { text };
    }
    return { response, payload };
  };
  const call = async (body: Record<string, unknown>) => {
    const result = await callRaw(body);
    if (!result.response.ok) {
      throw new Error(
        `${String(body.operation)} returned HTTP ${result.response.status}: ${JSON.stringify(result.payload)}`,
      );
    }
    return result.payload;
  };
  const completeRun = async (initial: MirrorRun, sourceView: "leaderboard" | "trending") => {
    let run = mirrorRunFromPayload(initial, `start-${sourceView}`);
    let steps = 0;
    let rateLimitRetries = 0;
    let rateLimitWaitMs = 0;
    let transportTimeouts = 0;
    if (run.status === "paused") {
      run = mirrorRunFromPayload(
        await call({
          operation: "resume",
          runId: requiredString(run.runId, "runId"),
          reason: `${options.reason} interrupted-run recovery`,
        }),
        "resume",
      );
    }
    while (run.status === "running") {
      if (steps >= MAX_STEPS)
        throw new Error(`skills.sh ${sourceView} exceeded ${MAX_STEPS} steps`);
      const request = {
        operation: sourceView === "leaderboard" ? "step" : "step-trending",
        runId: requiredString(run.runId, "runId"),
        page: requiredInteger(run.page, "page"),
        offset: requiredInteger(run.offset, "offset"),
      };
      let result: Awaited<ReturnType<typeof callRaw>>;
      try {
        result = await callRaw(request);
      } catch (error) {
        if (!isTransportTimeout(error)) throw error;
        transportTimeouts += 1;
        const authoritativeRun = mirrorRunFromPayload(
          await call({ operation: "run", runId: request.runId }),
          "run",
        );
        if (
          requiredString(authoritativeRun.runId, "runId") !== request.runId ||
          (authoritativeRun.sourceView ?? "leaderboard") !== sourceView
        ) {
          throw new Error(`timed-out ${request.operation} reconciled to a different durable run`);
        }
        run = authoritativeRun;
        const cursorAdvanced = run.page !== request.page || run.offset !== request.offset;
        if (cursorAdvanced) steps += 1;
        if (
          transportTimeouts >= MAX_TRANSPORT_TIMEOUTS &&
          run.status === "running" &&
          !cursorAdvanced
        ) {
          throw new Error(
            `${request.operation} timed out ${transportTimeouts} times at durable cursor ${request.page}:${request.offset}`,
          );
        }
        continue;
      }
      if (!result.response.ok) {
        const delayMs = mirrorRateLimitRetryDelayMs(
          result.response.status,
          result.response.headers.get("retry-after"),
          rateLimitRetries,
        );
        if (
          delayMs === null ||
          rateLimitRetries >= MAX_RATE_LIMIT_RETRIES ||
          rateLimitWaitMs + delayMs > MAX_RATE_LIMIT_WAIT_MS
        ) {
          throw new Error(
            `${request.operation} returned HTTP ${result.response.status}: ${JSON.stringify(result.payload)}`,
          );
        }
        rateLimitRetries += 1;
        rateLimitWaitMs += delayMs;
        await sleep(delayMs);
        continue;
      }
      run = mirrorRunFromPayload(result.payload, request.operation);
      steps += 1;
    }
    const reconciled = await reconcileMirrorRunToCompletion(run, async () =>
      call({ operation: "reconcile", runId: requiredString(run.runId, "runId"), limit: 250 }),
    );
    run = reconciled.run;
    return {
      ...assertCompletedMirrorRun(run, sourceView),
      syncProof: {
        steps,
        reconciliationBatches: reconciled.reconciliationBatches,
        rateLimitRetries,
        rateLimitWaitMs,
        transportTimeouts,
      },
    };
  };

  const reconcileTimedOutActivation = async (
    leaderboardRunId: string,
    trendingRunId: string,
  ): Promise<MirrorRun> => {
    for (let poll = 0; poll < MAX_ACTIVATION_RECONCILE_POLLS; poll += 1) {
      const leaderboard = mirrorRunFromPayload(
        await call({ operation: "run", runId: leaderboardRunId }),
        "run",
      );
      if (leaderboard.activatedTrendingRunId === trendingRunId) {
        return {
          ok: true,
          activated: true,
          reconciledAfterTimeout: true,
          leaderboardRunId,
          trendingRunId,
          snapshotId: requiredString(leaderboard.activationSnapshotId, "activationSnapshotId"),
          activatedAt: requiredInteger(leaderboard.activatedAt, "activatedAt"),
        };
      }
      const status = await call({ operation: "status" });
      const control = optionalRecord(status.control);
      if (!control || typeof control.activationLockToken !== "string") break;
      if (
        control.activationLeaderboardRunId !== leaderboardRunId ||
        control.activationTrendingRunId !== trendingRunId
      ) {
        throw new Error("timed-out verify-activate is bound to different source runs");
      }
      if (poll + 1 < MAX_ACTIVATION_RECONCILE_POLLS) {
        await sleep(ACTIVATION_RECONCILE_POLL_MS);
      }
    }
    throw new Error(
      "timed-out verify-activate did not produce an exact durable activation receipt",
    );
  };

  const reconcileTimedOutNativePreparation = async (
    preflightReason: string,
  ): Promise<MirrorRun> => {
    for (let poll = 0; poll < MAX_NATIVE_TRENDING_RECONCILE_POLLS; poll += 1) {
      const status = await call({ operation: "status" });
      const control = optionalRecord(status.control);
      const lockToken = control?.activationLockToken;
      if (typeof lockToken === "string") {
        if (
          !lockToken.startsWith("skills-sh-native-trending:") ||
          control?.reason !== preflightReason
        ) {
          throw new Error("timed-out native Trending preflight is bound to a different lock");
        }
        if (poll + 1 < MAX_NATIVE_TRENDING_RECONCILE_POLLS) {
          await sleep(ACTIVATION_RECONCILE_POLL_MS);
          continue;
        }
        break;
      }
      const nativeTrending = optionalRecord(status.nativeTrending);
      const sourceCounts = optionalRecord(nativeTrending?.sourceCounts);
      if (nativeTrending?.status !== "ready" || sourceCounts?.skillsShTrending !== 0) {
        throw new Error("native-only Trending preflight finished without a ready snapshot");
      }
      return {
        ok: true,
        nativeTrending,
        reconciledAfterTimeout: true,
      };
    }
    throw new Error("timed-out native Trending preflight did not release its exact durable lock");
  };

  const startedAt = Date.now();
  const before = await call({ operation: "status" });
  const publicVisible = (before.invariants as Record<string, unknown> | undefined)?.publicVisible;
  if (typeof publicVisible !== "boolean") {
    throw new Error("skills.sh mirror status is missing the public visibility invariant");
  }
  const recoverable = findRecoverableMirrorRun(before) as
    | (MirrorRun & { sourceView?: "leaderboard" | "trending" })
    | null;
  let nativeBefore: Record<string, unknown> | null = null;
  await call({ operation: "configure", enabled: true, reason: options.reason });
  try {
    if (!publicVisible) {
      const preflightReason = `${options.reason} native-only preflight`;
      try {
        nativeBefore = await call({
          operation: "prepare-native-trending",
          reason: preflightReason,
        });
      } catch (error) {
        if (!isTransportTimeout(error)) throw error;
        nativeBefore = await reconcileTimedOutNativePreparation(preflightReason);
      }
    }
    if (nativeBefore) {
      const nativeTrending = nativeBefore.nativeTrending as Record<string, unknown> | undefined;
      const sourceCounts = nativeTrending?.sourceCounts as Record<string, unknown> | undefined;
      if (nativeTrending?.status !== "ready" || sourceCounts?.skillsShTrending !== 0) {
        throw new Error("native-only canonical Trending preflight did not become ready");
      }
    }
    const recoveredSourceView = recoverable?.sourceView ?? "leaderboard";
    const recovered = recoverable ? await completeRun(recoverable, recoveredSourceView) : null;
    const leaderboard =
      recovered && recoveredSourceView === "leaderboard"
        ? recovered
        : await completeRun(
            await call({ operation: "start", reason: options.reason }),
            "leaderboard",
          );
    const trending = await completeRun(
      await call({ operation: "start-trending", reason: options.reason }),
      "trending",
    );
    let activation: MirrorRun;
    try {
      activation = await call({ operation: "verify-activate", reason: options.reason });
    } catch (error) {
      if (isTransportTimeout(error)) {
        activation = await reconcileTimedOutActivation(
          requiredString((leaderboard as MirrorRun).runId, "leaderboard.runId"),
          requiredString((trending as MirrorRun).runId, "trending.runId"),
        );
      } else {
        throw new UnsafeSkillsShCorpusError(error instanceof Error ? error.message : String(error));
      }
    }
    await call({ operation: "configure", enabled: false, reason: `${options.reason} complete` });
    const after = await call({ operation: "status" });
    return {
      ok: true as const,
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      before,
      ...(nativeBefore ? { nativeBefore } : {}),
      ...(recovered ? { recovered } : {}),
      leaderboard,
      trending,
      activation,
      after,
      scansPlanned: 0 as const,
      scansAdmitted: 0 as const,
    };
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const body of [
      ...(error instanceof UnsafeSkillsShCorpusError
        ? [{ operation: "deactivate", reason: `${options.reason} systemic failure` }]
        : []),
      { operation: "configure", enabled: false, reason: `${options.reason} failed` },
    ]) {
      try {
        await call(body);
      } catch (rollbackError) {
        rollbackErrors.push(
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        );
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      rollbackErrors.length > 0
        ? `${message}; rollback errors: ${rollbackErrors.join("; ")}`
        : message,
    );
  }
}

if (import.meta.main) {
  const targetUrl = requireEnv("CLAWHUB_SKILLS_SH_SYNC_URL");
  const staticAuthorization = process.env.CLAWHUB_SKILLS_SH_SYNC_TOKEN?.trim();
  const authorization =
    staticAuthorization ||
    createGitHubActionsOidcAuthorization({
      requestUrl: requireEnv("ACTIONS_ID_TOKEN_REQUEST_URL"),
      requestToken: requireEnv("ACTIONS_ID_TOKEN_REQUEST_TOKEN"),
    });
  const reason = process.env.CLAWHUB_SKILLS_SH_SYNC_REASON?.trim() || "hourly skills.sh sync";
  const outputPath = resolve(
    process.env.CLAWHUB_SKILLS_SH_SYNC_OUTPUT?.trim() || "skills-sh-sync-proof.json",
  );
  const proof = await runSkillsShSync({ targetUrl, authorization, reason });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}
