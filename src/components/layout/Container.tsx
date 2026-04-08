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
        size === "default" && "max-w-[1200px]",
        size === "narrow" && "max-w-[900px]",
        size === "wide" && "max-w-[1400px]",
        className,
      )}
      {...props}
    />
  ),
);
Container.displayName = "Container";

export { Container };
