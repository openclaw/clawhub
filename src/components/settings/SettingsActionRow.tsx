import type { ReactNode } from "react";

export function SettingsActionRow({
  title,
  description,
  children,
}: {
  title: string;
  description: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="skill-admin-row">
      <div className="skill-admin-row-copy">
        <h3>{title}</h3>
        {typeof description === "string" ? <p>{description}</p> : description}
      </div>
      {children}
    </div>
  );
}
