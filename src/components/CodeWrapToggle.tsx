import { WrapText } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useCodeWrapToggle(contentKey: string) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const [isWrapped, setIsWrapped] = useState(false);
  const [canWrap, setCanWrap] = useState(false);

  useEffect(() => {
    setIsWrapped(false);
  }, [contentKey]);

  useClientLayoutEffect(() => {
    const pre = preRef.current;
    if (!pre) {
      return undefined;
    }

    const updateWrapAvailability = () => {
      if (!isWrapped) {
        setCanWrap(pre.scrollWidth > pre.clientWidth + 1);
      }
    };

    updateWrapAvailability();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWrapAvailability);
      return () => window.removeEventListener("resize", updateWrapAvailability);
    }

    const observer = new ResizeObserver(updateWrapAvailability);
    observer.observe(pre);
    return () => observer.disconnect();
  }, [isWrapped, contentKey]);

  const toggleWrap = () => {
    setIsWrapped((wrapped) => !wrapped);
  };

  return { preRef, isWrapped, canWrap, toggleWrap };
}

export function CodeWrapToggleButton({
  isWrapped,
  onToggle,
}: {
  isWrapped: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="markdown-code-block-action"
      aria-label={isWrapped ? "Disable line wrap" : "Enable line wrap"}
      aria-pressed={isWrapped}
      onClick={onToggle}
    >
      <WrapText className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}
