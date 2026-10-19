import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS, VOICE_PART_STYLES } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function VoicePartBadge({ part, className }: { part: VoicePart; className?: string }) {
  const style = VOICE_PART_STYLES[part];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        style.soft,
        style.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", style.dot)} />
      {VOICE_PART_LABELS[part]}
    </span>
  );
}
