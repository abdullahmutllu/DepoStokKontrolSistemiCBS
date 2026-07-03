import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { OccupancyBucket } from "@/features/three/occupancy";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
  {
    variants: {
      variant: {
        default: "bg-ink-700 text-text-muted",
        accent: "bg-accent/15 text-accent",
        low: "bg-status-low/15 text-status-low",
        mid: "bg-status-mid/15 text-status-mid",
        high: "bg-status-high/15 text-status-high",
        empty: "bg-ink-700 text-text-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Colored dot + label chip for the occupancy scale. */
export function OccupancyBadge({ bucket, percent }: { bucket: OccupancyBucket; percent?: number | null }) {
  const labels: Record<OccupancyBucket, string> = {
    empty: "Boş",
    low: "Rahat",
    mid: "Doluyor",
    high: "Dolu",
  };
  return (
    <Badge variant={bucket}>
      <span
        className="inline-block size-1.5 rounded-full"
        style={{
          backgroundColor: "currentColor",
        }}
      />
      {labels[bucket]}
      {percent != null && <span className="mono">%{Math.round(percent)}</span>}
    </Badge>
  );
}
