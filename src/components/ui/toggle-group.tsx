import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const toggleGroupItemVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-[color:var(--ink-soft)] transition-colors hover:text-[color:var(--ink)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-fg [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "",
        outline:
          "border border-[color:var(--border-ui)] data-[state=on]:border-[color:var(--accent)]",
      },
      size: {
        default: "h-[30px] min-w-[30px] px-2 text-sm",
        sm: "h-7 min-w-7 px-1.5 text-xs",
        lg: "h-9 min-w-9 px-3 text-sm",
        icon: "h-[30px] w-[30px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "icon",
    },
  },
);

const ToggleGroupContext = React.createContext<VariantProps<typeof toggleGroupItemVariants>>({
  variant: "default",
  size: "icon",
});

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleGroupItemVariants>
>(({ className, variant = "default", size = "icon", children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    data-slot="toggle-group"
    data-variant={variant}
    data-size={size}
    className={cn(
      "inline-flex h-[38px] items-center gap-0.5 rounded-[var(--radius-pill)] border border-[color:var(--line)] bg-[color:var(--surface)] p-[3px]",
      className,
    )}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
));
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleGroupItemVariants>
>(({ className, variant, size, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      data-slot="toggle-group-item"
      data-variant={context.variant ?? variant}
      data-size={context.size ?? size}
      className={cn(
        toggleGroupItemVariants({
          variant: variant ?? context.variant,
          size: size ?? context.size,
          className,
        }),
      )}
      {...props}
    />
  );
});
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem, toggleGroupItemVariants };
