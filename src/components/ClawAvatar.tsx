import { useState, type CSSProperties } from "react";

// Identity stays stable across the featured strip, rows, and the detail page.
export function ClawAvatar({
  name,
  label,
  imageUrl,
  size = "row",
}: {
  name: string;
  label: string;
  imageUrl?: string | null;
  size?: "row" | "featured" | "detail";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  let hash = 0;
  for (const letter of name) hash = (Math.imul(hash, 31) + letter.charCodeAt(0)) >>> 0;
  const initials = label
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join("")
    .toLocaleUpperCase();
  const safeImage =
    imageUrl && (/^https?:\/\//.test(imageUrl) || /^\/(?!\/)/.test(imageUrl)) ? imageUrl : null;
  return (
    <span
      className={`claw-avatar claw-avatar-${size}`}
      data-pattern={hash % 3}
      style={{ "--claw-hue": `${Math.round((hash * 137.508) % 360)}` } as CSSProperties}
      aria-hidden="true"
    >
      {safeImage && safeImage !== failedUrl ? (
        <img
          src={safeImage}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(safeImage)}
        />
      ) : (
        <span className="claw-avatar-monogram">{initials || "C"}</span>
      )}
    </span>
  );
}
