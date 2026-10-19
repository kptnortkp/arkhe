"use server";

import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  assignments,
  LINK_KINDS,
  PIECE_STATUSES,
  pieceLinks,
  pieces,
  VOICE_PARTS,
} from "@/db/schema";
import { assertManager } from "@/lib/auth/dal";
import { parseDuration } from "@/lib/format";
import { cleanLine } from "@/lib/text";
import {
  BULK_MAX_LINES,
  DUPLICATE_IN_PASTE,
  DUPLICATE_LINK,
  INVALID_LINK,
  LABEL_MAX,
  LINK_MAX,
  parseLink,
} from "@/lib/links";
import {
  fieldErrorsOf,
  formValues,
  optionalLine,
  optionalText,
  type FormState,
} from "@/lib/validation";

const FORBIDDEN = "Bu işlem için yetkin yok.";
const NOT_FOUND = "Eser bulunamadı.";
const LINK_NOT_FOUND = "Bağlantı bulunamadı.";
const STALE = "Liste bu arada değişti. Sayfayı yenileyip tekrar dene.";
const ARCHIVED_PROGRAM = "Arşivdeki eser programa eklenemez.";
const HAS_HOMEWORK = "Bu esere bağlı ödevler var. Silmek yerine arşivle.";

const idSchema = z.uuid();

function revalidatePiece(id?: string) {
  revalidatePath("/");
  revalidatePath("/repertuvar");
  if (id) {
    revalidatePath(`/repertuvar/${id}`);
    revalidatePath(`/repertuvar/${id}/duzenle`);
  }
}

function hasMessage(error: unknown, text: string) {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if (e instanceof Error && e.message.includes(text)) return true;
  }
  return false;
}

const isUniqueUrlError = (error: unknown) =>
  hasMessage(error, "piece_links.piece_id, piece_links.url");

const pieceSchema = z.object({
  title: z
    .string()
    .overwrite(cleanLine)
    .trim()
    .min(1, "Eser adı gerekli.")
    .max(120, "En fazla 120 karakter."),
  composer: optionalLine(120),
  arranger: optionalLine(120),
  language: optionalLine(40),
  voicing: optionalLine(20),
  duration: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      const sec = parseDuration(v);
      if (sec === null) {
        ctx.addIssue({ code: "custom", message: "Süreyi dakika:saniye olarak gir (ör. 3:40)." });
        return z.NEVER;
      }
      return sec;
    }),
  status: z.enum(PIECE_STATUSES, "Bir durum seç."),
  notes: optionalText(1000),
  driveFolderUrl: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v?.trim()) return null;
      const parsed = parseLink(v);
      if (!parsed) {
        ctx.addIssue({ code: "custom", message: INVALID_LINK });
        return z.NEVER;
      }
      if (parsed.provider !== "drive-folder") {
        ctx.addIssue({ code: "custom", message: "Bu bir Drive klasörü bağlantısı değil." });
        return z.NEVER;
      }
      return parsed.url;
    }),
});

function pieceValues(d: z.infer<typeof pieceSchema>) {
  return {
    title: d.title,
    composer: d.composer,
    arranger: d.arranger,
    language: d.language,
    voicing: d.voicing,
    durationSec: d.duration,
    status: d.status,
    notes: d.notes,
    driveFolderUrl: d.driveFolderUrl,
  };
}

/** Returns the new id in `values.id`; the form navigates so it can show a toast first. */
export async function createPiece(_prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const parsed = pieceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const id = crypto.randomUUID();
  await db.insert(pieces).values({ id, ...pieceValues(parsed.data), createdBy: actor.id });
  revalidatePiece();
  return { success: "Eser eklendi. Şimdi bağlantılarını ekle.", values: { id } };
}

export async function updatePiece(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const parsed = pieceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  const values = pieceValues(parsed.data);
  const updated = await db
    .update(pieces)
    .set({
      ...values,
      ...(values.status === "archive" ? { programPosition: null } : {}),
    })
    .where(eq(pieces.id, id))
    .returning({ id: pieces.id });
  if (updated.length === 0) return { error: NOT_FOUND };
  revalidatePiece(id);
  return { success: "Kaydedildi.", values: formValues(formData) };
}

export async function setPieceStatus(id: string, status: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  const parsed = z
    .object({ id: idSchema, status: z.enum(PIECE_STATUSES) })
    .safeParse({ id, status });
  if (!parsed.success) return { error: NOT_FOUND };
  const updated = await db
    .update(pieces)
    .set({
      status: parsed.data.status,
      ...(parsed.data.status === "archive" ? { programPosition: null } : {}),
    })
    .where(eq(pieces.id, id))
    .returning({ id: pieces.id });
  if (updated.length === 0) return { error: NOT_FOUND };
  revalidatePiece(id);
  return { success: parsed.data.status === "archive" ? "Arşive taşındı." : "Arşivden çıkarıldı." };
}

export async function deletePiece(id: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  let deleted: { id: string }[] | "homework";
  try {
    deleted = await db.transaction(async (tx) => {
      const [homework] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(eq(assignments.pieceId, id))
        .limit(1);
      if (homework) return "homework" as const;
      await tx.delete(pieceLinks).where(eq(pieceLinks.pieceId, id));
      return tx.delete(pieces).where(eq(pieces.id, id)).returning({ id: pieces.id });
    });
  } catch (error) {
    // Backstop for a homework created in between: the restrict FK rolls the delete back.
    if (!hasMessage(error, "FOREIGN KEY constraint failed")) throw error;
    deleted = "homework";
  }
  if (deleted === "homework") return { error: HAS_HOMEWORK };
  if (deleted.length === 0) return { error: NOT_FOUND };
  revalidatePiece(id);
  return { success: "Eser silindi." };
}

// Links ---------------------------------------------------------------------------------------

const linkSchema = z.object({
  url: z
    .string()
    .max(LINK_MAX + 100, INVALID_LINK)
    .transform((v, ctx) => {
      const parsed = parseLink(v);
      if (!parsed) {
        ctx.addIssue({ code: "custom", message: INVALID_LINK });
        return z.NEVER;
      }
      return parsed.url;
    }),
  kind: z.enum(LINK_KINDS, "Bir tür seç."),
  voicePart: z
    .enum([...VOICE_PARTS, ""], "Bir partisyon seç.")
    .optional()
    .transform((v) => v || null),
  label: optionalLine(LABEL_MAX),
});

const nextPosition = (pieceId: string) =>
  sql`(select coalesce(max(${pieceLinks.position}), 0) + 1 from ${pieceLinks} where ${pieceLinks.pieceId} = ${pieceId})`;

async function pieceExists(id: string) {
  const [row] = await db.select({ id: pieces.id }).from(pieces).where(eq(pieces.id, id));
  return Boolean(row);
}

export async function addLink(
  pieceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(pieceId).success || !(await pieceExists(pieceId))) {
    return { error: NOT_FOUND };
  }
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  try {
    await db.insert(pieceLinks).values({
      pieceId,
      ...parsed.data,
      position: nextPosition(pieceId),
    });
  } catch (error) {
    if (!isUniqueUrlError(error)) throw error;
    return { values: formValues(formData), fieldErrors: { url: [DUPLICATE_LINK] } };
  }
  revalidatePiece(pieceId);
  return { success: "Bağlantı eklendi." };
}

export async function updateLink(
  linkId: string,
  pieceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(linkId).success || !idSchema.safeParse(pieceId).success) {
    return { error: LINK_NOT_FOUND };
  }
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return fieldErrorsOf(parsed.error, formData);
  let updated: { id: string }[];
  try {
    updated = await db
      .update(pieceLinks)
      .set(parsed.data)
      .where(and(eq(pieceLinks.id, linkId), eq(pieceLinks.pieceId, pieceId)))
      .returning({ id: pieceLinks.id });
  } catch (error) {
    if (!isUniqueUrlError(error)) throw error;
    return { values: formValues(formData), fieldErrors: { url: [DUPLICATE_LINK] } };
  }
  if (updated.length === 0) return { error: LINK_NOT_FOUND };
  revalidatePiece(pieceId);
  return { success: "Kaydedildi." };
}

export async function deleteLink(linkId: string, pieceId: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(linkId).success || !idSchema.safeParse(pieceId).success) {
    return { error: LINK_NOT_FOUND };
  }
  const deleted = await db
    .delete(pieceLinks)
    .where(and(eq(pieceLinks.id, linkId), eq(pieceLinks.pieceId, pieceId)))
    .returning({ id: pieceLinks.id });
  if (deleted.length === 0) return { error: LINK_NOT_FOUND };
  revalidatePiece(pieceId);
  return { success: "Bağlantı silindi." };
}

const orderSchema = z.array(idSchema).max(200);

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && new Set(a).size === a.length && b.every((x) => a.includes(x));
}

/** Takes the full new order, so a double tap or replay is harmless and concurrent edits are caught. */
export async function reorderLinks(pieceId: string, orderedIds: string[]): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  const ids = orderSchema.safeParse(orderedIds);
  if (!idSchema.safeParse(pieceId).success || !ids.success) return { error: STALE };
  const error = await db.transaction(async (tx) => {
    const current = await tx
      .select({ id: pieceLinks.id })
      .from(pieceLinks)
      .where(eq(pieceLinks.pieceId, pieceId));
    if (
      !sameSet(
        ids.data,
        current.map((r) => r.id),
      )
    )
      return STALE;
    for (const [i, id] of ids.data.entries()) {
      await tx
        .update(pieceLinks)
        .set({ position: i + 1 })
        .where(eq(pieceLinks.id, id));
    }
    return null;
  });
  if (error) return { error };
  revalidatePiece(pieceId);
  return {};
}

const bulkRowSchema = z.object({
  label: z
    .string()
    .overwrite(cleanLine)
    .trim()
    .max(LABEL_MAX)
    .nullable()
    .transform((v) => v || null),
  kind: z.enum([...LINK_KINDS, "folder"]),
  voicePart: z.enum(VOICE_PARTS).nullable(),
  url: z.string().max(LINK_MAX + 100),
});

/** All or nothing: any bad row rejects the whole save with per-row errors. */
export async function saveBulkLinks(
  pieceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(pieceId).success) return { error: NOT_FOUND };
  const raw = formData.get("rows");
  if (typeof raw !== "string" || raw.length > 200_000) return { error: INVALID_LINK };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { error: INVALID_LINK };
  }
  const parsed = z.array(bulkRowSchema).min(1).max(BULK_MAX_LINES).safeParse(json);
  if (!parsed.success) return { error: "Kaydedilecek geçerli satır yok." };

  const rowErrors: Record<number, string> = {};
  const rows = parsed.data.map((row, i) => {
    const link = parseLink(row.url);
    if (!link) rowErrors[i] = INVALID_LINK;
    else if (row.kind === "folder" && link.provider !== "drive-folder") rowErrors[i] = INVALID_LINK;
    return { ...row, url: link?.url ?? row.url };
  });
  if (Object.keys(rowErrors).length) {
    return { error: `${Object.keys(rowErrors).length} satırda hata var.`, rowErrors };
  }

  const result = await db.transaction(async (tx) => {
    const [piece] = await tx
      .select({ folder: pieces.driveFolderUrl })
      .from(pieces)
      .where(eq(pieces.id, pieceId));
    if (!piece) return { error: NOT_FOUND };
    const existing = new Set(
      (
        await tx
          .select({ url: pieceLinks.url })
          .from(pieceLinks)
          .where(eq(pieceLinks.pieceId, pieceId))
      ).map((r) => r.url),
    );
    const seen = new Set<string>();
    for (const [i, row] of rows.entries()) {
      if (existing.has(row.url)) rowErrors[i] = DUPLICATE_LINK;
      else if (seen.has(row.url)) rowErrors[i] = DUPLICATE_IN_PASTE;
      seen.add(row.url);
    }
    if (Object.keys(rowErrors).length) {
      return { error: `${Object.keys(rowErrors).length} satırda hata var.`, rowErrors };
    }
    let folderSet = false;
    const links = [];
    for (const row of rows) {
      if (row.kind === "folder" && !piece.folder && !folderSet) {
        folderSet = true;
        await tx.update(pieces).set({ driveFolderUrl: row.url }).where(eq(pieces.id, pieceId));
        continue;
      }
      const kind = row.kind === "folder" ? "other" : row.kind;
      links.push({ pieceId, kind, voicePart: row.voicePart, label: row.label, url: row.url });
    }
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${pieceLinks.position}), 0)` })
      .from(pieceLinks)
      .where(eq(pieceLinks.pieceId, pieceId));
    if (links.length) {
      await tx.insert(pieceLinks).values(links.map((l, i) => ({ ...l, position: max + 1 + i })));
    }
    const added = `${links.length} bağlantı eklendi.`;
    return { success: folderSet ? `${added} Drive klasörü de ayarlandı.` : added };
  });
  revalidatePiece(pieceId);
  return result;
}

// Programme -----------------------------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Positions are unique, and SQLite checks that per row, so clear first and then number 1..n. */
async function renumberProgram(tx: Tx, orderedIds: string[]) {
  await tx.update(pieces).set({ programPosition: null }).where(isNotNull(pieces.programPosition));
  for (const [i, id] of orderedIds.entries()) {
    await tx
      .update(pieces)
      .set({ programPosition: i + 1 })
      .where(eq(pieces.id, id));
  }
}

async function programIds(tx: Tx | typeof db) {
  const rows = await tx
    .select({ id: pieces.id })
    .from(pieces)
    .where(isNotNull(pieces.programPosition))
    .orderBy(asc(pieces.programPosition));
  return rows.map((r) => r.id);
}

export async function addToProgram(id: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  const updated = await db
    .update(pieces)
    .set({
      programPosition: sql`(select coalesce(max(${pieces.programPosition}), 0) + 1 from ${pieces})`,
    })
    .where(and(eq(pieces.id, id), isNull(pieces.programPosition), ne(pieces.status, "archive")))
    .returning({ id: pieces.id });
  if (updated.length === 0) {
    const [piece] = await db
      .select({ status: pieces.status })
      .from(pieces)
      .where(eq(pieces.id, id));
    if (!piece) return { error: NOT_FOUND };
    if (piece.status === "archive") return { error: ARCHIVED_PROGRAM };
  }
  const rank = (await programIds(db)).indexOf(id) + 1;
  revalidatePiece(id);
  return { success: `Programa eklendi (${rank}. sıra).` };
}

export async function removeFromProgram(id: string): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  if (!idSchema.safeParse(id).success) return { error: NOT_FOUND };
  await db.transaction(async (tx) => {
    const ids = await programIds(tx);
    if (ids.includes(id))
      await renumberProgram(
        tx,
        ids.filter((x) => x !== id),
      );
  });
  revalidatePiece(id);
  return { success: "Programdan çıkarıldı." };
}

export async function reorderProgram(orderedIds: string[]): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  const ids = orderSchema.safeParse(orderedIds);
  if (!ids.success) return { error: STALE };
  const error = await db.transaction(async (tx) => {
    if (!sameSet(ids.data, await programIds(tx))) return STALE;
    await renumberProgram(tx, ids.data);
    return null;
  });
  if (error) return { error };
  revalidatePiece();
  return {};
}

export async function clearProgram(): Promise<FormState> {
  if (!(await assertManager())) return { error: FORBIDDEN };
  await db.update(pieces).set({ programPosition: null }).where(isNotNull(pieces.programPosition));
  revalidatePiece();
  return { success: "Program temizlendi." };
}
