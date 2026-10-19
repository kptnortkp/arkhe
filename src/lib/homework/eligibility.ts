import type { Role, VoicePart } from "@/db/schema";

export type Singer = {
  role: Role;
  voicePart: VoicePart | null;
  joinedAt: Date;
  leftAt: Date | null;
};

/** May see the submit button: an active singer whose current part is in the homework. */
export function isEligible(u: Singer, parts: readonly VoicePart[]) {
  return (
    u.leftAt === null &&
    (u.role === "member" || u.role === "board") &&
    u.voicePart !== null &&
    parts.includes(u.voicePart)
  );
}

/** Counted in the denominator: eligible and already a member when the homework was given. */
export function isExpected(u: Singer, a: { parts: readonly VoicePart[]; createdAt: Date }) {
  return isEligible(u, a.parts) && u.joinedAt <= a.createdAt;
}
