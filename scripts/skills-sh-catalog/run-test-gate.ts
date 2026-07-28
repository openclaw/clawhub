#!/usr/bin/env bun

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const targetUrl = requireEnv("CLAWHUB_TEST_CATALOG_GATE_URL");
const operatorAuthorization = requireEnv("CLAWHUB_TEST_OPERATOR_TOKEN");
const mode = process.env.CLAWHUB_TEST_CATALOG_MODE?.trim() || "live-500";
if (mode !== "live-500" && mode !== "controlled-canary") {
  throw new Error("CLAWHUB_TEST_CATALOG_MODE must be live-500 or controlled-canary");
}
const allowlist = (process.env.CLAWHUB_TEST_CATALOG_ALLOWLIST ?? "")
  .split(",")
  .map((externalId) => externalId.trim().toLowerCase())
  .filter(Boolean);
if (allowlist.length > 10) throw new Error("CLAWHUB_TEST_CATALOG_ALLOWLIST cannot exceed 10");
if (mode === "controlled-canary" && allowlist.length > 0) {
  throw new Error("The controlled canary does not admit scans");
}

async function callGate(body: Record<string, unknown>) {
  const response = await fetch(targetUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${operatorAuthorization}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return { response, text: await response.text() };
}

const request = {
  allowlist,
  mode,
  reason:
    mode === "controlled-canary"
      ? "CLAW-557 controlled hidden metadata canary"
      : "CLAW-556 bounded permanent Test proof",
};
const execution = await callGate(request);
if (!execution.response.ok) {
  throw new Error(
    `Permanent Test catalog gate returned HTTP ${execution.response.status}: ${execution.text}`,
  );
}
console.log(JSON.stringify(JSON.parse(execution.text) as Record<string, unknown>));

export {};
