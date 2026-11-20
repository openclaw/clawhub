import { useId, useRef, useState, type ReactNode } from "react";

const contentTabs = {
  template: ["CLAW.md", "Skills", "Automations", "Plugins", "Workspace files"],
  // Only these tabs are unconditional on a plugin listing. Optional tabs would reveal its contents.
  plugin: ["README.md", "Versions"],
} as const;

type Kind = keyof typeof contentTabs;
type Tab<K extends Kind> = (typeof contentTabs)[K][number];

/** Local navigation only. The caller decides what content the viewer may see. */
export function PackageContentTabs<K extends Kind>({
  routeKind,
  renderPanel,
}: {
  routeKind: K;
  renderPanel: (tab: Tab<K>) => ReactNode;
}) {
  const tabs: readonly Tab<K>[] = contentTabs[routeKind];
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  const template = routeKind === "template";
  const label = template ? "Template contents" : "Plugin detail tabs";
  return (
    <section
      className={template ? "template-detail-contents" : "tab-card detail-mobile-tabs"}
      aria-label={label}
    >
      <div
        className={template ? "template-detail-tabs" : "tab-header"}
        role="tablist"
        aria-label={label}
      >
        {tabs.map((tab, index) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={id + "-tab-" + index}
            aria-controls={id + "-panel-" + index}
            aria-selected={active === index}
            className={
              template ? undefined : active === index ? "tab-button is-active" : "tab-button"
            }
            tabIndex={active === index ? 0 : -1}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              setActive(next);
              tabRefs.current[next]?.focus();
            }}
          >
            {tab}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab}
          role="tabpanel"
          id={id + "-panel-" + index}
          aria-labelledby={id + "-tab-" + index}
          tabIndex={0}
          hidden={active !== index}
          className={template ? "template-detail-panel" : active === index ? "tab-body" : undefined}
        >
          {active === index ? renderPanel(tab) : null}
        </div>
      ))}
    </section>
  );
}
