// Existing overrides may select a model with different supported effort levels.
// Inject the approved policy only for the documented Luna/Sol families; preserve
// the provider defaults of other explicit models, including original GPT-5.
export function applicationReasoning(model: string, effort: "low" | "none") {
  if (/^gpt-6(?:\.\d+)?-(?:luna|sol)(?:-|$)/.test(model)) {
    return { effort: effort === "none" && /-sol(?:-|$)/.test(model) ? "low" : effort };
  }
  return undefined;
}
