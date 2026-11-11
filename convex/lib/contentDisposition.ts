export function contentDispositionAttachment(filename: string) {
  const leaf = filename.split(/[/\\]/).pop()?.trim() || "download";
  // encodeURIComponent leaves * ' ( ) raw. Those are not RFC 5987 attr-chars.
  const encoded = encodeURIComponent(leaf).replace(
    /[*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const extension = leaf.match(/\.(?:tgz|zip)$/i)?.[0]?.toLowerCase() ?? "";
  const stem = extension ? leaf.slice(0, -extension.length) : leaf;
  const stemIsSafe = /^[A-Za-z0-9._+-]+$/.test(stem) && !stem.startsWith(".");
  const asciiStem = stemIsSafe
    ? stem
    : stem.replace(/[^A-Za-z0-9_+-]+/g, "_").replace(/^_+|_+$/g, "") || "download";
  return `attachment; filename="${asciiStem}${extension}"; filename*=UTF-8''${encoded}`;
}
