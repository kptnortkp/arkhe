import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";

export type AudioRow = {
  id: string;
  /** null = Tutti. */
  voicePart: VoicePart | null;
  label: string | null;
  /** The label, else the part (`Alto`, `Tutti`): the row shows the part beside it anyway. */
  title: string;
  sizeBytes: number;
};

type Raw = { id: string; part: VoicePart | null; label: string | null; size: number };

const toRow = (r: Raw): AudioRow => ({
  id: r.id,
  voicePart: r.part,
  label: r.label,
  title: r.label ?? (r.part ? VOICE_PART_LABELS[r.part] : "Tutti"),
  sizeBytes: Number(r.size),
});

const ORDER = sql`order by a.voice_part is not null, case a.voice_part when 'soprano' then 1
  when 'alto' then 2 when 'tenor' then 3 when 'bass' then 4 end, a.label, a.created_at`;

/** The detail page (no storage key): Tutti plus the filtered part, or every file for "all". */
export async function audioForPiece(pieceId: string, part: VoicePart | "all" | null) {
  const filter =
    part === "all"
      ? sql``
      : part === null
        ? sql`and a.voice_part is null`
        : sql`and (a.voice_part is null or a.voice_part = ${part})`;
  const rows = await db.all<Raw>(
    sql`select a.id, a.voice_part as part, a.label, a.size_bytes as size from piece_audio a
        where a.piece_id = ${pieceId} ${filter} ${ORDER}`,
  );
  return rows.map(toRow);
}

/** Uploaded audio a member can play as "Partisyonum": files for the part, else Tutti files. */
export async function audioCountsFor(pieceIds: string[], part: VoicePart | null) {
  const counts = new Map<string, number>();
  if (!part || pieceIds.length === 0) return counts;
  const rows = await db.all<{ piece: string; exact: number; tutti: number }>(sql`
    select piece_id as piece, sum(voice_part = ${part}) as exact, sum(voice_part is null) as tutti
    from piece_audio where piece_id in (${sql.join(
      pieceIds.map((id) => sql`${id}`),
      sql`, `,
    )})
    group by piece_id`);
  for (const r of rows) counts.set(r.piece, Number(r.exact) || Number(r.tutti) || 0);
  return counts;
}
