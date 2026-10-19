import { cn } from "@/lib/utils";
import {
  LOCKUP_BOX,
  MONOGRAM_BOX,
  MONOGRAM_PATH,
  MONOGRAM_PATH_SMALL,
  WORDMARK_BOX,
  WORDMARK_PATH,
  WORDMARK_PATH_SMALL,
} from "@/lib/brand/logo-geometry";
import { SUBTITLE_PATH } from "@/lib/brand/logo-geometry.generated";

/** "small" widens the hairlines so they survive below 32 px tall. */
type Density = "regular" | "small";

function Mark({
  box,
  d,
  label,
  className,
}: {
  box: { width: number; height: number };
  d: string;
  label: string;
  className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${box.width} ${box.height}`}
      role="img"
      aria-label={label}
      fill="currentColor"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

/** ARKHE letters only. */
export function ArkheWordmark({
  className,
  density = "regular",
}: {
  className?: string;
  density?: Density;
}) {
  return (
    <Mark
      box={WORDMARK_BOX}
      d={density === "small" ? WORDMARK_PATH_SMALL : WORDMARK_PATH}
      label="Arkhe"
      className={cn("h-6 w-auto", className)}
    />
  );
}

/** Wordmark with "MÜLKİYE ÇOKSESLİ KOROSU" under it; keep it at least 160 px wide. */
export function ArkheLockup({ className }: { className?: string }) {
  return (
    <Mark
      box={LOCKUP_BOX}
      d={WORDMARK_PATH + SUBTITLE_PATH}
      label="Arkhe Mülkiye Çoksesli Korosu"
      className={cn("h-auto w-48", className)}
    />
  );
}

/** The A alone, for tiles and icons. */
export function ArkheMonogram({
  className,
  density = "regular",
}: {
  className?: string;
  density?: Density;
}) {
  return (
    <Mark
      box={MONOGRAM_BOX}
      d={density === "small" ? MONOGRAM_PATH_SMALL : MONOGRAM_PATH}
      label="Arkhe"
      className={cn("h-6 w-auto", className)}
    />
  );
}
