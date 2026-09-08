import type { SearchDigest } from "./searchDigest";

export async function deliverSearchDigest(
  payload: SearchDigest,
  baseUrl: string,
  token: string | undefined,
): Promise<{ delivered: true } | { delivered: false; failureCode: string }> {
  if (!token) return { delivered: false, failureCode: "missing_hermit_configuration" };
  try {
    const target = new URL("/api/clawhub-search-intelligence/weekly", baseUrl);
    if (
      target.protocol !== "https:" &&
      !(
        target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)
      )
    ) {
      return { delivered: false, failureCode: "invalid_hermit_configuration" };
    }
    const response = await fetch(target.toString(), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { delivered: false, failureCode: "hermit_http_failure" };
    const receipt: unknown = await response.json();
    if (
      !receipt ||
      typeof receipt !== "object" ||
      !("ok" in receipt) ||
      receipt.ok !== true ||
      !("delivered" in receipt) ||
      receipt.delivered !== true ||
      !("weekEnd" in receipt) ||
      receipt.weekEnd !== payload.weekEnd
    ) {
      return { delivered: false, failureCode: "invalid_hermit_receipt" };
    }
    return { delivered: true };
  } catch {
    return { delivered: false, failureCode: "hermit_transport_failure" };
  }
}
