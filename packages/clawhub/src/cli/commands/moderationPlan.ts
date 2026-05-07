import { fail, isInteractive, promptConfirm } from "../ui.js";

type ModerationPlanOptions = {
  json?: boolean;
  yes?: boolean;
};

type ModerationPlan = {
  subject: string;
  outcome: string;
  impacts: string[];
  requiresConfirmation: boolean;
  confirmPrompt: string;
};

export function reportModerationPlan(params: {
  entityLabel: "skill" | "package";
  reportId: string;
  status: "open" | "confirmed" | "dismissed";
  finalAction?: "none" | "hide" | "quarantine" | "revoke";
}): ModerationPlan {
  const impacts: string[] = [];
  if (params.status === "open") {
    impacts.push("Reopen the report for review.");
  } else if (params.status === "confirmed") {
    impacts.push("Mark the report as confirmed.");
  } else {
    impacts.push("Dismiss the report without changing artifact availability.");
  }

  if (params.finalAction === "hide") {
    impacts.push("Hide the skill from public availability.");
  } else if (params.finalAction === "quarantine") {
    impacts.push("Quarantine the package release.");
  } else if (params.finalAction === "revoke") {
    impacts.push("Revoke the package release.");
  }

  const action = params.finalAction && params.finalAction !== "none" ? params.finalAction : "none";
  return {
    subject: `${params.entityLabel} report ${params.reportId}`,
    outcome: `set status to ${params.status}; final action ${action}`,
    impacts,
    requiresConfirmation: action !== "none",
    confirmPrompt: `Apply this ${params.entityLabel} report action?`,
  };
}

export function appealModerationPlan(params: {
  entityLabel: "skill" | "package";
  appealId: string;
  status: "open" | "accepted" | "rejected";
  finalAction?: "none" | "restore" | "approve";
}): ModerationPlan {
  const impacts: string[] = [];
  if (params.status === "open") {
    impacts.push("Reopen the appeal for review.");
  } else if (params.status === "accepted") {
    impacts.push("Accept the appeal.");
  } else {
    impacts.push("Reject the appeal without changing artifact availability.");
  }

  if (params.finalAction === "restore") {
    impacts.push("Restore the skill to public availability.");
  } else if (params.finalAction === "approve") {
    impacts.push("Approve the package release.");
  }

  const action = params.finalAction && params.finalAction !== "none" ? params.finalAction : "none";
  return {
    subject: `${params.entityLabel} appeal ${params.appealId}`,
    outcome: `set status to ${params.status}; final action ${action}`,
    impacts,
    requiresConfirmation: action !== "none",
    confirmPrompt: `Apply this ${params.entityLabel} appeal action?`,
  };
}

export async function presentModerationPlan(plan: ModerationPlan, options: ModerationPlanOptions) {
  if (!options.json) {
    console.log("Moderation action summary");
    console.log(`  case: ${plan.subject}`);
    console.log(`  outcome: ${plan.outcome}`);
    console.log("  public impact:");
    for (const impact of plan.impacts) {
      console.log(`  - ${impact}`);
    }
  }

  if (!plan.requiresConfirmation || options.yes) return;
  if (!isInteractive()) fail("Pass --yes (no input)");
  const confirmed = await promptConfirm(plan.confirmPrompt);
  if (!confirmed) fail("Canceled");
}
