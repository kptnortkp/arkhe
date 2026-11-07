import { VOICE_PARTS, type Role, type VoicePart, type VoiceSection } from "@/db/schema";

export type Singer = {
  role: Role;
  voicePart: VoicePart | null;
  voiceSection: VoiceSection | null;
  joinedAt: Date;
  leftAt: Date | null;
};

/** One assignment_parts row: a whole part (section null) or one sub-part of it. */
export type PartTarget = { part: VoicePart; section: VoiceSection | null };

export const ALL_PARTS: readonly PartTarget[] = VOICE_PARTS.map((part) => ({ part, section: null }));

/** Matches a singer to a target; a singer without a section never matches a section-only target. */
export function inTargets(
  u: { voicePart: VoicePart | null; voiceSection: VoiceSection | null },
  targets: readonly PartTarget[],
) {
  return (
    u.voicePart !== null &&
    targets.some(
      (t) => t.part === u.voicePart && (t.section === null || t.section === u.voiceSection),
    )
  );
}

/** May see the submit button: an active singer whose current part (and section) is in the homework. */
export function isEligible(u: Singer, targets: readonly PartTarget[]) {
  return u.leftAt === null && (u.role === "member" || u.role === "board") && inTargets(u, targets);
}

/** Counted in the denominator: eligible and already a member when the homework was given. */
export function isExpected(u: Singer, a: { parts: readonly PartTarget[]; createdAt: Date }) {
  return isEligible(u, a.parts) && u.joinedAt <= a.createdAt;
}

export const sortTargets = (targets: PartTarget[]) =>
  targets.sort((a, b) => VOICE_PARTS.indexOf(a.part) - VOICE_PARTS.indexOf(b.part));

/** Parses `group_concat(voice_part || ':' || coalesce(section, ''))`, e.g. "bass:1,alto:". */
export function parseTargets(raw: string | null): PartTarget[] {
  if (!raw) return [];
  return sortTargets(
    raw
      .split(",")
      .filter(Boolean)
      .map((s) => {
        const [part, section] = s.split(":");
        return {
          part: part as VoicePart,
          section: section === "1" ? 1 : section === "2" ? 2 : null,
        };
      }),
  );
}
