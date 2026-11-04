import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { MidiStatus, VoicePart } from "@/db/schema";
import { VOICE_PART_LABELS } from "@/lib/labels";
import type { AutoTrack } from "@/lib/omr/parts";

export type MidiRow = {
  id: string;
  /** null = Tutti. */
  voicePart: VoicePart | null;
  label: string | null;
  /** `Alto önde · Alto` or `MIDI · Alto` / `MIDI · Tutti`. */
  title: string;
  sizeBytes: number;
  /** D116: a converter result, shown in its own `Otomatik oluşturulan` group. */
  auto: boolean;
  status: MidiStatus;
  tracks: AutoTrack[];
  measures: number | null;
  durationSec: number | null;
  createdAt: Date;
  publishedAt: Date | null;
  publisherName: string | null;
};

const partLabel = (p: VoicePart | null) => (p ? VOICE_PART_LABELS[p] : "Tutti");

type Raw = {
  id: string;
  part: VoicePart | null;
  label: string | null;
  size: number;
  auto: number;
  status: MidiStatus;
  tracks: string | null;
  measures: number | null;
  duration: number | null;
  created: number;
  published: number | null;
  publisher: string | null;
};

function parseTracks(json: string | null): AutoTrack[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as AutoTrack[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toRow(r: Raw): MidiRow {
  return {
    id: r.id,
    voicePart: r.part,
    label: r.label,
    title: `${r.label ?? "MIDI"} · ${partLabel(r.part)}`,
    sizeBytes: Number(r.size),
    auto: Boolean(Number(r.auto)),
    status: r.status,
    tracks: parseTracks(r.tracks),
    measures: r.measures === null ? null : Number(r.measures),
    durationSec: r.duration === null ? null : Number(r.duration),
    createdAt: new Date(Number(r.created) * 1000),
    publishedAt: r.published === null ? null : new Date(Number(r.published) * 1000),
    publisherName: r.publisher,
  };
}

const COLUMNS = sql`m.id, m.voice_part as part, m.label, m.size_bytes as size, m.auto, m.status,
  m.tracks_json as tracks, m.measures, m.duration_sec as duration, m.created_at as created,
  m.published_at as published, u.name as publisher`;
const FROM = sql`from midi_files m left join users u on u.id = m.published_by`;
const ORDER = sql`order by m.voice_part is not null, case m.voice_part when 'soprano' then 1
  when 'alto' then 2 when 'tenor' then 3 when 'bass' then 4 end, m.label, m.created_at`;
/** The one filter every member-facing read goes through (D103). */
const PUBLISHED = sql`m.status = 'published'`;

/**
 * A piece's published MIDI files for the detail page (no storage key). `part` follows the page's
 * part filter for manual files: Tutti plus that part, or every file for "all". The automatic file
 * holds every part, so the filter never hides it (D118).
 */
export async function midiForPiece(pieceId: string, part: VoicePart | "all" | null) {
  const filter =
    part === "all"
      ? sql``
      : part === null
        ? sql`and (m.auto = 1 or m.voice_part is null)`
        : sql`and (m.auto = 1 or m.voice_part is null or m.voice_part = ${part})`;
  const rows = await db.all<Raw>(
    sql`select ${COLUMNS} ${FROM} where m.piece_id = ${pieceId} and ${PUBLISHED} ${filter} ${ORDER}`,
  );
  return rows.map(toRow);
}

/** The editor (managers): every file, drafts included. */
export async function midiForEditor(pieceId: string) {
  const rows = await db.all<Raw>(sql`select ${COLUMNS} ${FROM} where m.piece_id = ${pieceId} ${ORDER}`);
  const all = rows.map(toRow);
  return {
    manual: all.filter((m) => !m.auto),
    published: all.find((m) => m.auto && m.status === "published") ?? null,
    draft: all.find((m) => m.auto && m.status === "draft") ?? null,
  };
}

async function manualFor(pieceId: string, part: VoicePart | null) {
  const [r] = await db.all<Raw>(
    sql`select ${COLUMNS} ${FROM} where m.piece_id = ${pieceId} and ${PUBLISHED} and m.auto = 0
        and ${part === null ? sql`m.voice_part is null` : sql`m.voice_part = ${part}`}
        order by m.created_at limit 1`,
  );
  return r ? toRow(r) : null;
}

async function publishedAuto(pieceId: string) {
  const [r] = await db.all<Raw>(
    sql`select ${COLUMNS} ${FROM} where m.piece_id = ${pieceId} and ${PUBLISHED} and m.auto = 1 limit 1`,
  );
  return r ? toRow(r) : null;
}

const hasPart = (m: MidiRow, part: VoicePart) => m.tracks.some((t) => t.parts.includes(part));

/** `emphasize`: open the player with `{ses} önde` (D107). */
export type ChosenMidi = { row: MidiRow; emphasize: boolean };

/**
 * The piece's `Partisyonumu çal` (D117): a manual file for my exact part, else the published
 * automatic file when it has a track for my part (with `önde`), else no hero.
 */
export async function heroMidi(pieceId: string, part: VoicePart): Promise<ChosenMidi | null> {
  const exact = await manualFor(pieceId, part);
  if (exact) return { row: exact, emphasize: false };
  const auto = await publishedAuto(pieceId);
  return auto && hasPart(auto, part) ? { row: auto, emphasize: true } : null;
}

/**
 * The homework's `MIDI'yi çal` (D117): manual exact part → automatic with my track (`önde`) →
 * manual Tutti → automatic without emphasis.
 */
export async function homeworkMidi(pieceId: string, part: VoicePart | null): Promise<ChosenMidi | null> {
  const exact = part ? await manualFor(pieceId, part) : null;
  if (exact) return { row: exact, emphasize: false };
  const auto = await publishedAuto(pieceId);
  if (auto && part && hasPart(auto, part)) return { row: auto, emphasize: true };
  const tutti = await manualFor(pieceId, null);
  if (tutti) return { row: tutti, emphasize: false };
  return auto ? { row: auto, emphasize: false } : null;
}

/** Every part at once, for playing along: a manual Tutti file, else the published automatic one. */
export async function tuttiMidi(pieceId: string) {
  return (await manualFor(pieceId, null)) ?? (await publishedAuto(pieceId));
}

/** Published files of both kinds: "does this piece have MIDI". */
export async function midiCount(pieceId: string) {
  const [r] = await db.all<{ n: number }>(
    sql`select count(*) as n from midi_files where piece_id = ${pieceId} and status = 'published'`,
  );
  return Number(r?.n ?? 0);
}

/** The manual cap (MIDI_MAX_PER_PIECE) counts manual files only (D116). */
export async function manualMidiCount(pieceId: string) {
  const [r] = await db.all<{ n: number }>(
    sql`select count(*) as n from midi_files where piece_id = ${pieceId} and auto = 0`,
  );
  return Number(r?.n ?? 0);
}

export type ScoreRow = { id: string; sizeBytes: number; uploadedAt: Date };

/** The piece's score PDF, for every signed-in user (D94); never the storage key. */
export async function scoreForPiece(pieceId: string): Promise<ScoreRow | null> {
  const [r] = await db.all<{ id: string; size: number; at: number }>(
    sql`select id, size_bytes as size, uploaded_at as at from piece_scores where piece_id = ${pieceId}`,
  );
  return r ? { id: r.id, sizeBytes: Number(r.size), uploadedAt: new Date(Number(r.at) * 1000) } : null;
}
