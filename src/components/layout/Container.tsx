import * as React from "react";
import { cn } from "../../lib/utils";

interface ContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "default" | "narrow" | "wide";
}

const Container = React.forwardRef<HTMLDivElement, ContainerProps>(
  ({ className, size = "default", ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-7",
        size === "default" && "max-w-page-max",
        size === "narrow" && "max-w-page-narrow",
        size === "wide" && "w-full",
        className,
      )}
      {...props}
    />
  ),
);
Container.displayName = "Container";

export { Container };
