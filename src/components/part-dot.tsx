import type { VoicePart } from "@/db/schema";
import { VOICE_PART_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";

/** Voice part colour; Tutti is a hollow ring. Always sits next to the part's name. */
export function PartDot({ part }: { part: VoicePart | null }) {
  return part ? (
    <span className={cn("size-2 shrink-0 rounded-full", VOICE_PART_STYLES[part].dot)} />
  ) : (
    <span className="size-2 shrink-0 rounded-full ring-1 ring-foreground/40" />
  );
}
