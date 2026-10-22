import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";

export type MidiRow = {
  id: string;
  /** null = Tutti. */
  voicePart: VoicePart | null;
  label: string | null;
  /** `Alto önde · Alto` or `MIDI · Alto` / `MIDI · Tutti`. */
  title: string;
  sizeBytes: number;
};

const partLabel = (p: VoicePart | null) => (p ? VOICE_PART_LABELS[p] : "Tutti");

function toRow(r: { id: string; part: VoicePart | null; label: string | null; size: number }) {
  return {
    id: r.id,
    voicePart: r.part,
    label: r.label,
    title: `${r.label ?? "MIDI"} · ${partLabel(r.part)}`,
    sizeBytes: Number(r.size),
  } satisfies MidiRow;
}

/**
 * A piece's MIDI files for the detail page (no storage key). `part` follows the page's part
 * filter: Tutti plus that part, or every file for "all".
 */
export async function midiForPiece(pieceId: string, part: VoicePart | "all" | null) {
  const filter =
    part === "all"
      ? sql``
      : part === null
        ? sql`and voice_part is null`
        : sql`and (voice_part is null or voice_part = ${part})`;
  const rows = await db.all<{
    id: string;
    part: VoicePart | null;
    label: string | null;
    size: number;
  }>(
    sql`select id, voice_part as part, label, size_bytes as size from midi_files
        where piece_id = ${pieceId} ${filter}
        order by voice_part is not null, case voice_part when 'soprano' then 1 when 'alto' then 2
          when 'tenor' then 3 when 'bass' then 4 end, label, created_at`,
  );
  return rows.map(toRow);
}

/** The homework's `MIDI'yi çal` and the piece's `Partisyonumu çal`: my part's file, else Tutti. */
export async function midiForPart(pieceId: string, part: VoicePart | null) {
  const [r] = await db.all<{
    id: string;
    part: VoicePart | null;
    label: string | null;
    size: number;
  }>(
    sql`select id, voice_part as part, label, size_bytes as size from midi_files
        where piece_id = ${pieceId} and (voice_part is null or voice_part = ${part})
        order by voice_part is null, created_at limit 1`,
  );
  return r ? toRow(r) : null;
}

/** Only an exact part file (no Tutti fallback): decides the piece page's hero button (D59). */
export async function midiForExactPart(pieceId: string, part: VoicePart) {
  const [r] = await db.all<{
    id: string;
    part: VoicePart | null;
    label: string | null;
    size: number;
  }>(
    sql`select id, voice_part as part, label, size_bytes as size from midi_files
        where piece_id = ${pieceId} and voice_part = ${part} order by created_at limit 1`,
  );
  return r ? toRow(r) : null;
}

export async function midiCount(pieceId: string) {
  const [r] = await db.all<{ n: number }>(
    sql`select count(*) as n from midi_files where piece_id = ${pieceId}`,
  );
  return Number(r?.n ?? 0);
}
