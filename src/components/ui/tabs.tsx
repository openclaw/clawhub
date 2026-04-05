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
      "inline-flex items-center gap-0 border-b border-[color:var(--line)]",
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
      "relative cursor-pointer border-none bg-transparent px-4 pb-2.5 pt-2 text-sm font-medium text-[color:var(--ink-soft)] transition-colors duration-150",
      "hover:text-[color:var(--ink)]",
      // Active: accent underline, no shadow/background
      "data-[state=active]:text-[color:var(--ink)]",
      "after:absolute after:inset-x-0 after:bottom-[-1px] after:h-[2px] after:bg-transparent after:transition-colors after:duration-150",
      "data-[state=active]:after:bg-[color:var(--accent)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2",
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
      "mt-4 grid max-w-full gap-5 overflow-x-auto",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
