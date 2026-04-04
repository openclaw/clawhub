type VerifiedPublisherBadgeProps = {
  compact?: boolean;
};

export function VerifiedPublisherBadge({ compact = false }: VerifiedPublisherBadgeProps) {
  return (
    <span className={`tag verified-publisher-badge${compact ? " tag-compact" : ""}`}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Verified publisher"
        style={{ flexShrink: 0 }}
      >
        <path
          d="M8 0L9.79 1.52L12.12 1.21L12.93 3.41L15.01 4.58L14.42 6.84L15.56 8.82L14.12 10.5L14.12 12.82L11.86 13.41L10.34 15.27L8 14.58L5.66 15.27L4.14 13.41L1.88 12.82L1.88 10.5L0.44 8.82L1.58 6.84L0.99 4.58L3.07 3.41L3.88 1.21L6.21 1.52L8 0Z"
          fill="currentColor"
        />
        <path
          d="M5.5 8L7 9.5L10.5 6"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Verified publisher
    </span>
  );
}
