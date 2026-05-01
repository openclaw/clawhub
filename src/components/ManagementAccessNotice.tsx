import type { Doc } from "../../convex/_generated/dataModel";
import { Card } from "./ui/card";

type Props = {
  me: Doc<"users"> | null | undefined;
  requiredRole?: "admin" | "moderator";
};

export function ManagementAccessNotice({ me, requiredRole = "moderator" }: Props) {
  const role = me?.role ?? "none";
  const requirement = requiredRole === "admin" ? "admin" : "admin or moderator";
  const identity = me?.handle || me?.displayName || me?.name || me?._id || "not signed in";

  return (
    <main className="section">
      <Card>
        <div className="management-report-item">
          <span className="management-report-meta">access</span>
          <strong className="text-[color:var(--ink)]">Management access required</strong>
        </div>
        <p className="section-subtitle m-0 mt-2">
          Signed in as {identity} with role {role}. This page requires {requirement} access.
        </p>
        <p className="section-subtitle m-0 mt-2">
          Use the Users panel on the root management page, or an admin CLI token, to grant the
          correct role before returning here.
        </p>
      </Card>
    </main>
  );
}
