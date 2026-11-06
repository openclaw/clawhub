import type { IntermediaryDisclosure as Disclosure } from "clawhub-schema";

export function IntermediaryDisclosure({
  requiresIntermediary,
  intermediaryDetails,
}: Partial<Disclosure>) {
  const label =
    requiresIntermediary === true ? "Yes" : requiresIntermediary === false ? "No" : "Unknown";
  return (
    <div className="intermediary-disclosure">
      <div>
        <strong>{label}</strong>
        {requiresIntermediary != null ? (
          <span className="intermediary-disclosure-attribution"> · AI-inferred</span>
        ) : null}
      </div>
      <p>
        {intermediaryDetails ||
          "Intermediary requirements have not been determined for this version."}
      </p>
    </div>
  );
}
