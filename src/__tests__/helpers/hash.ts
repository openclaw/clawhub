export async function sha256Hex(value: string | Blob) {
  const bytes =
    typeof value === "string"
      ? new TextEncoder().encode(value)
      : new Uint8Array(await value.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
