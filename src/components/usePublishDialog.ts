import { useEffect, useRef, useState } from "react";
import { captureAnalyticsOperation, emitAnalytics } from "../lib/analyticsEvents";
import { copyText } from "./InstallCopyButton";

export function usePublishDialog({
  isOpen,
  popupId,
  linkUrl,
  onDismiss,
}: {
  isOpen: boolean;
  popupId: "plugin_submitted" | "skill_published";
  linkUrl: string;
  onDismiss: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [dismissed, setDismissed] = useState(false);
  const hasDismissedRef = useRef(false);
  const hasViewedRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      if (!hasViewedRef.current)
        emitAnalytics("popup_view", { popup_id: popupId, ui_location: "publish" });
      hasViewedRef.current = true;
      setCopyState("idle");
      setDismissed(false);
      hasDismissedRef.current = false;
    }
  }, [isOpen, popupId]);

  function dismiss(method: "button" | "escape" | "outside" | "programmatic" = "button") {
    if (hasDismissedRef.current) return;
    hasDismissedRef.current = true;
    hasViewedRef.current = false;
    emitAnalytics("popup_dismiss", {
      popup_id: popupId,
      ui_location: "publish",
      dismiss_method: method,
    });
    setDismissed(true);
    onDismiss();
  }

  async function copyLink() {
    const operation = captureAnalyticsOperation();
    try {
      const didCopy = await copyText(linkUrl);
      operation?.emit("copy_action", {
        content_type: "navigation",
        action_result: didCopy ? "success" : "error",
        ui_location: "publish",
        method: "link",
      });
      setCopyState(didCopy ? "copied" : "failed");
    } catch {
      operation?.emit("copy_action", {
        content_type: "navigation",
        action_result: "error",
        ui_location: "publish",
        method: "link",
      });
      setCopyState("failed");
    }
  }

  return { copyState, dismissed, dismiss, copyLink };
}
