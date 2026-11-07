import type { VoicePart, VoiceSection } from "@/db/schema";
import { VOICE_PART_STYLES, partLabel } from "@/lib/labels";
import { cn } from "@/lib/utils";

export function VoicePartBadge({
  part,
  section = null,
  className,
}: {
  part: VoicePart;
  /** Shown as "Bas 2" when set. */
  section?: VoiceSection | null;
  className?: string;
}) {
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
      {partLabel(part, section)}
    </span>
  );
}
