import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { pieceLinks, pieces, type PieceStatus, type VoicePart } from "@/db/schema";
import { collator, searchKey } from "@/lib/format";
import { resolveMyPart } from "@/lib/links";

export const LIST_VIEWS = ["calisiliyor", "program", "hazir", "arsiv", "tumu"] as const;
export type ListView = (typeof LIST_VIEWS)[number];

const VIEW_STATUS: Partial<Record<ListView, PieceStatus>> = {
  calisiliyor: "learning",
  hazir: "concert",
  arsiv: "archive",
};

const listColumns = {
  id: pieces.id,
  title: pieces.title,
  composer: pieces.composer,
  arranger: pieces.arranger,
  language: pieces.language,
  voicing: pieces.voicing,
  durationSec: pieces.durationSec,
  status: pieces.status,
  programPosition: pieces.programPosition,
};

export type PieceSummary = Awaited<ReturnType<typeof listAllPieces>>[number];
export type PartFile = {
  id: string;
  label: string | null;
  voicePart: VoicePart | null;
  url: string;
  position: number;
};
export type MyPart = { links: PartFile[]; tutti: boolean } | null;

async function listAllPieces() {
  return db.select(listColumns).from(pieces);
}

/** One query for every row's part files, so the list never goes N+1. */
async function partFilesOf(ids: string[]) {
  const byPiece = new Map<string, PartFile[]>();
  if (ids.length === 0) return byPiece;
  const rows = await db
    .select({
      id: pieceLinks.id,
      pieceId: pieceLinks.pieceId,
      label: pieceLinks.label,
      voicePart: pieceLinks.voicePart,
      url: pieceLinks.url,
      position: pieceLinks.position,
    })
    .from(pieceLinks)
    .where(and(eq(pieceLinks.kind, "part"), inArray(pieceLinks.pieceId, ids)))
    .orderBy(asc(pieceLinks.position));
  for (const { pieceId, ...link } of rows) {
    byPiece.set(pieceId, [...(byPiece.get(pieceId) ?? []), link]);
  }
  return byPiece;
}

export async function withMyPart<T extends { id: string }>(rows: T[], myPart: VoicePart | null) {
  const files = myPart ? await partFilesOf(rows.map((r) => r.id)) : new Map<string, PartFile[]>();
  return rows.map((r) => ({
    ...r,
    myPart: resolveMyPart(files.get(r.id) ?? [], myPart) as MyPart,
  }));
}

export async function listPieces(view: ListView, q: string) {
  const all = await listAllPieces();
  const counts = {
    calisiliyor: all.filter((p) => p.status === "learning").length,
    program: all.filter((p) => p.programPosition !== null).length,
    hazir: all.filter((p) => p.status === "concert").length,
    arsiv: all.filter((p) => p.status === "archive").length,
    tumu: all.length,
  } satisfies Record<ListView, number>;

  let shown: PieceSummary[];
  if (q) {
    const key = searchKey(q);
    shown = all.filter((p) =>
      searchKey(`${p.title} ${p.composer ?? ""} ${p.arranger ?? ""}`).includes(key),
    );
  } else if (view === "program") {
    shown = all.filter((p) => p.programPosition !== null);
  } else if (view === "tumu") {
    shown = all;
  } else {
    shown = all.filter((p) => p.status === VIEW_STATUS[view]);
  }
  if (view === "program" && !q) {
    shown.sort((a, b) => a.programPosition! - b.programPosition!);
  } else {
    shown.sort((a, b) => collator.compare(a.title, b.title));
  }
  return { shown, counts, total: all.length };
}

export async function learningPieces() {
  const rows = await db.select(listColumns).from(pieces).where(eq(pieces.status, "learning"));
  return rows.sort((a, b) => collator.compare(a.title, b.title));
}

export async function getPiece(id: string) {
  const [piece] = await db.select().from(pieces).where(eq(pieces.id, id));
  if (!piece) return null;
  const links = await db
    .select()
    .from(pieceLinks)
    .where(eq(pieceLinks.pieceId, id))
    .orderBy(asc(pieceLinks.position), asc(pieceLinks.id));
  return { piece, links };
}

/** 1-based place in the programme, from the order rather than the stored (possibly gappy) value. */
export async function programRank(id: string) {
  const rows = await db
    .select({ id: pieces.id })
    .from(pieces)
    .where(isNotNull(pieces.programPosition))
    .orderBy(asc(pieces.programPosition));
  const index = rows.findIndex((r) => r.id === id);
  return index < 0 ? null : index + 1;
}
