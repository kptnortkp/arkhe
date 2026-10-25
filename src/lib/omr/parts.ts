// Isomorphic: which voice parts a track name stands for. Mirrors the player's mapping (D106).
import type { VoicePart } from "@/db/schema";

const fold = (s: string) =>
  s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

export function isPianoName(name: string) {
  return /\b(piyano|piano|pf|klavye)/.test(fold(name));
}

export function partsOfTrackName(name: string): VoicePart[] {
  const n = fold(name);
  if (isPianoName(name)) return [];
  if (/\b(kadin|women|female)/.test(n)) return ["soprano", "alto"];
  if (/\b(erkek|men\b|male)/.test(n)) return ["tenor", "bass"];
  const parts: VoicePart[] = [];
  if (/sop/.test(n)) parts.push("soprano");
  if (/alt/.test(n)) parts.push("alto");
  if (/ten/.test(n)) parts.push("tenor");
  if (/\bbas/.test(n)) parts.push("bass");
  return parts;
}

export type AutoTrack = { name: string; parts: VoicePart[] };
