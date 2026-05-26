import { Archive, Code2, FileText, Folder, Package, Wrench } from "lucide-react";
import type { ComponentType } from "react";

type DecorIconProps = {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  className: string;
};

const decorIconsByKind = {
  skill: [
    { icon: FileText, className: "left-[9%] top-[18%] -rotate-12" },
    { icon: Code2, className: "left-[13%] bottom-[18%] rotate-8" },
    { icon: Wrench, className: "right-[9%] top-[18%] rotate-12" },
    { icon: Package, className: "right-[13%] bottom-[18%] -rotate-10" },
  ],
  plugin: [
    { icon: Package, className: "left-[9%] top-[18%] -rotate-12" },
    { icon: Archive, className: "left-[13%] bottom-[18%] rotate-8" },
    { icon: Folder, className: "right-[9%] top-[18%] rotate-12" },
    { icon: Code2, className: "right-[13%] bottom-[18%] -rotate-10" },
  ],
} as const;

export function UploadDropzoneDecor({ kind = "skill" }: { kind?: keyof typeof decorIconsByKind }) {
  const decorIcons = decorIconsByKind[kind];

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      <div
        className="absolute inset-x-0 -inset-y-8 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at center, color-mix(in srgb, var(--accent) 10%, transparent), transparent 72%)",
        }}
      />
      {decorIcons.map((item) => (
        <DecorIcon key={item.className} icon={item.icon} className={item.className} />
      ))}
    </div>
  );
}

function DecorIcon({ icon: Icon, className }: DecorIconProps) {
  return (
    <span
      className={`absolute hidden h-11 w-11 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--line)] bg-[color:var(--surface)]/70 text-[color:var(--ink-soft)] opacity-45 shadow-sm sm:flex ${className}`}
    >
      <Icon className="h-5 w-5" strokeWidth={1.8} />
    </span>
  );
}
