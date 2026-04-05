import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as React from "react";
import { cn } from "../../lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Matches .tab-header
      "inline-flex items-center gap-1.5 self-start rounded-[var(--radius-pill)] border border-[color:var(--line)] bg-[color:var(--surface-muted)] p-1",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Matches .tab-button
      "min-h-[44px] cursor-pointer rounded-[var(--radius-pill)] border-none bg-transparent px-4 py-2.5 font-[650] text-[color:var(--ink-soft)] transition-all duration-200",
      "hover:text-[color:var(--ink)]",
      // Matches .tab-button.is-active
      "data-[state=active]:bg-[color:var(--surface)] data-[state=active]:text-[color:var(--ink)] data-[state=active]:shadow-[0_8px_18px_rgba(29,26,23,0.12)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      // Matches .tab-body
      "grid max-w-full gap-5 overflow-x-auto",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
