import { useCallback, useRef, useState } from "react";

export function useChangelogPreview() {
  const [changelog, setChangelog] = useState("");
  const active = useRef<"manual" | { key: string } | null>(null);

  const editChangelog = useCallback((value: string) => {
    active.current = "manual";
    setChangelog(value);
  }, []);

  const invalidateChangelog = useCallback(() => {
    if (active.current === "manual") return false;
    active.current = null;
    setChangelog("");
    return true;
  }, []);

  const startChangelogPreview = useCallback(
    (
      key: string,
      read: () => Promise<string>,
      generate: (text: string) => Promise<{ changelog: string }>,
    ) => {
      if (active.current === "manual" || active.current?.key === key) return null;
      const request = { key };
      active.current = request;
      const isCurrent = () => active.current === request;
      const promise = read()
        .then((text) => (isCurrent() ? generate(text) : null))
        .then((result) => {
          if (!result || !isCurrent()) return false;
          setChangelog(result.changelog);
          return true;
        });
      return { promise, isCurrent };
    },
    [],
  );

  return { changelog, editChangelog, invalidateChangelog, startChangelogPreview };
}
