import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import { formatLongDate, formatTime } from "@/lib/time";

// No ?, &, %, #, whitespace or CR/LF, so the address can sit unencoded in a mailto URL.
export const RECORDING_EMAIL_RE = /^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const SUBJECT_MAX = 200;

export function barsLabel(from: number | null, to: number | null) {
  if (from === null || to === null) return "Tüm eser";
  return from === to ? `Ölçü ${from}` : `Ölçü ${from}–${to}`;
}

/** Strips control characters and collapses whitespace; guards against header-like input. */
function clean(text: string) {
  return text
    .toWellFormed()
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type HomeworkRef = { pieceTitle: string; barFrom: number | null; barTo: number | null };

export function homeworkSubject(a: HomeworkRef, part: VoicePart, name: string) {
  const tail = [barsLabel(a.barFrom, a.barTo), VOICE_PART_LABELS[part], clean(name)];
  let title = clean(a.pieceTitle);
  const build = () => ["Arkhe ödev", title, ...tail].join(" · ");
  if (build().length > SUBJECT_MAX) {
    const room = SUBJECT_MAX - build().length + title.length - 1;
    // Cut by code points so an emoji or 𝄞 is never split into a lone surrogate.
    title = `${Array.from(title).slice(0, Math.max(room, 1)).join("").trimEnd()}…`;
  }
  return build();
}

export function homeworkBody(a: HomeworkRef, dueAt: Date, name: string) {
  return [
    "Merhaba,",
    "",
    "ödev kaydım ekte.",
    "",
    `Eser: ${clean(a.pieceTitle)}`,
    `Ölçüler: ${barsLabel(a.barFrom, a.barTo)}`,
    `Son tarih: ${formatLongDate.format(dueAt)} ${formatTime.format(dueAt)}`,
    "",
    clean(name),
  ].join("\r\n");
}

/** Null unless the address is safe; uses encodeURIComponent (spaces as %20, never "+"). */
export function mailtoHref(email: string, subject: string, body: string) {
  if (!RECORDING_EMAIL_RE.test(email)) return null;
  try {
    return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } catch {
    // A malformed string hides the mail button instead of failing the page.
    return null;
  }
}
