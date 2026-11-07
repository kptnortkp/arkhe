import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { VoicePart, VoiceSection } from "@/db/schema";
import { partLabel } from "@/lib/labels";

export type AudioRow = {
  id: string;
  /** null = Tutti. */
  voicePart: VoicePart | null;
  /** Sub-part (Bas 2); null = the whole part. */
  section: VoiceSection | null;
  label: string | null;
  /** The label, else the part (`Alto 1`, `Tutti`): the row shows the part beside it anyway. */
  title: string;
  sizeBytes: number;
};

type Raw = {
  id: string;
  part: VoicePart | null;
  section: VoiceSection | null;
  label: string | null;
  size: number;
};

const toRow = (r: Raw): AudioRow => ({
  id: r.id,
  voicePart: r.part,
  section: r.section,
  label: r.label,
  title: r.label ?? (r.part ? partLabel(r.part, r.section) : "Tutti"),
  sizeBytes: Number(r.size),
});

/** Tutti, then the parts in order; within the singer's part their own sub-part comes first. */
function order(mySection: VoiceSection | null) {
  return sql`order by a.voice_part is not null, case a.voice_part when 'soprano' then 1
  when 'alto' then 2 when 'tenor' then 3 when 'bass' then 4 end,
  case when a.section is ${mySection} then 0 when a.section is null then 1 else 2 end,
  a.section, a.label, a.created_at`;
}

/**
 * The detail page (no storage key): Tutti plus the filtered part, or every file for "all".
 * `mySection` only orders the rows.
 */
export async function audioForPiece(
  pieceId: string,
  part: VoicePart | "all" | null,
  mySection: VoiceSection | null = null,
) {
  const filter =
    part === "all"
      ? sql``
      : part === null
        ? sql`and a.voice_part is null`
        : sql`and (a.voice_part is null or a.voice_part = ${part})`;
  const rows = await db.all<Raw>(
    sql`select a.id, a.voice_part as part, a.section, a.label, a.size_bytes as size from piece_audio a
        where a.piece_id = ${pieceId} ${filter} ${order(mySection)}`,
  );
  return rows.map(toRow);
}

/**
 * The singer's own rehearsal audio: same part and sub-part, then the whole part, then the other
 * sub-part (so a Bas 2 still hears Bas 1). Without a sub-part: whole part, then 1, then 2.
 */
export function pickMyAudio<T extends { voicePart: VoicePart | null; section: VoiceSection | null }>(
  rows: readonly T[],
  part: VoicePart | null,
  section: VoiceSection | null,
): T | undefined {
  if (!part) return undefined;
  const rank = (r: T) => (r.section === section ? 0 : r.section === null ? 1 : 1 + r.section);
  return rows
    .filter((r) => r.voicePart === part)
    .reduce<T | undefined>((best, r) => (!best || rank(r) < rank(best) ? r : best), undefined);
}

/** Uploaded audio a member can play as "Partisyonum": files for the part (any sub-part), else Tutti. */
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
