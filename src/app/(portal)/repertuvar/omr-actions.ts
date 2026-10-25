"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { writeTx } from "@/db/write-tx";
import { assertManager } from "@/lib/auth/dal";
import { omrConfigured } from "@/lib/omr/config";
import {
  OMR_LAYOUTS,
  OMR_MSG,
  OMR_TEMPO_MAX,
  OMR_TEMPO_MIN,
  omrFailureText,
  type OmrLayout,
} from "@/lib/omr/constants";
import { expireStale, jobById, startJob, type StartInput } from "@/lib/omr/jobs";
import { midiPublished } from "@/lib/push/triggers";
import { drainKeys } from "@/lib/storage/ledger";
import { MSG } from "@/lib/storage/messages";
import { now } from "@/lib/time";
import { formValues, type FormState } from "@/lib/validation";

const idSchema = z.uuid();

function revalidatePiece(pieceId: string) {
  revalidatePath(`/repertuvar/${pieceId}`);
  revalidatePath(`/repertuvar/${pieceId}/duzenle`);
  revalidatePath("/odevler", "layout");
  revalidatePath("/");
}

async function start(actorId: string, pieceId: string, input: StartInput): Promise<FormState> {
  const result = await startJob(actorId, pieceId, input);
  if ("error" in result) return { error: result.error };
  revalidatePiece(pieceId);
  if (result.dispatchError) return { error: omrFailureText(result.dispatchError, null, null) };
  return { success: OMR_MSG.started };
}

/** `MIDI'ye çevir` (D96): layout required, piano on/off, optional tempo 40–220. */
export async function startOmr(pieceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(pieceId).success) return { error: MSG.pieceNotFound };
  if (!omrConfigured()) return { error: OMR_MSG.notConfigured };
  const values = formValues(formData);
  const layout = OMR_LAYOUTS.find((l) => l === formData.get("layout")) as OmrLayout | undefined;
  const tempoRaw = String(formData.get("tempo") ?? "").trim();
  const tempo = tempoRaw === "" ? null : Number(tempoRaw);
  const fieldErrors: Record<string, string[]> = {};
  if (!layout) fieldErrors.layout = [OMR_MSG.layoutRequired];
  if (tempo !== null && (!Number.isInteger(tempo) || tempo < OMR_TEMPO_MIN || tempo > OMR_TEMPO_MAX)) {
    fieldErrors.tempo = [OMR_MSG.tempoRange];
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  const piano = formData.get("piano") === "on" || formData.get("piano") === "true";
  const result = await start(actor.id, pieceId, { layout: layout!, piano, tempo });
  return result.error ? { ...result, values } : result;
}

/** `Yeniden dene`: a new job with the failed job's PDF and options. */
export async function retryOmr(jobId: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(jobId).success) return { error: MSG.generic };
  if (!omrConfigured()) return { error: OMR_MSG.notConfigured };
  const job = await jobById(jobId);
  if (!job) return { error: MSG.generic };
  if (job.state !== "failed") return { error: OMR_MSG.active };
  return start(actor.id, job.pieceId, { layout: job.layout, piano: job.piano, tempo: job.tempo });
}

/** `Sil` on the score: refused while a conversion is active (D111); automatic MIDIs stay. */
export async function deleteScore(pieceId: string): Promise<FormState> {
  if (!(await assertManager())) return { error: MSG.forbidden };
  if (!idSchema.safeParse(pieceId).success) return { error: MSG.fileNotFound };
  await expireStale({ pieceId });
  const result = await writeTx(async (tx) => {
    const [active] = await tx.all<{ id: string }>(
      sql`select id from omr_jobs where piece_id = ${pieceId} and state in ('queued', 'running')`,
    );
    if (active) return "locked" as const;
    return tx.all<{ storage_key: string }>(
      sql`delete from piece_scores where piece_id = ${pieceId} returning storage_key`,
    );
  });
  if (result === "locked") return { error: OMR_MSG.scoreLocked };
  if (result.length === 0) return { error: MSG.fileNotFound };
  await drainKeys(result.map((r) => r.storage_key));
  revalidatePiece(pieceId);
  return { success: OMR_MSG.scoreDeleted };
}

/**
 * `Yayınla` (D103, D114): any manager. The previous published automatic file goes in the same
 * transaction (its key queued by the trigger); manual files are never touched. Pushes to the choir.
 */
export async function publishDraft(midiId: string): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(midiId).success) return { error: MSG.fileNotFound };
  const at = Math.floor(now().getTime() / 1000);
  const result = await writeTx(async (tx) => {
    const [draft] = await tx.all<{ piece_id: string; title: string }>(sql`
      select m.piece_id, p.title from midi_files m join pieces p on p.id = m.piece_id
      where m.id = ${midiId} and m.auto = 1 and m.status = 'draft'`);
    if (!draft) return null;
    const old = await tx.all<{ storage_key: string }>(sql`
      delete from midi_files where piece_id = ${draft.piece_id} and auto = 1 and status = 'published'
      returning storage_key`);
    await tx.run(sql`
      update midi_files set status = 'published', published_by = ${actor.id}, published_at = ${at}
      where id = ${midiId} and status = 'draft'`);
    return { pieceId: draft.piece_id, title: draft.title, old: old.map((o) => o.storage_key) };
  });
  if (!result) return { error: MSG.fileNotFound };
  await drainKeys(result.old);
  await midiPublished({ id: result.pieceId, title: result.title }, midiId, actor.id);
  revalidatePiece(result.pieceId);
  console.log("omr draft published", { midi: midiId });
  return { success: OMR_MSG.published };
}

/** `Sil` on a draft: hard delete, the trigger queues the file. A second call finds nothing. */
export async function deleteDraft(midiId: string): Promise<FormState> {
  if (!(await assertManager())) return { error: MSG.forbidden };
  if (!idSchema.safeParse(midiId).success) return { error: MSG.fileNotFound };
  const deleted = await writeTx((tx) =>
    tx.all<{ storage_key: string; piece_id: string }>(sql`
      delete from midi_files where id = ${midiId} and auto = 1 and status = 'draft'
      returning storage_key, piece_id`),
  );
  if (deleted.length === 0) return { error: MSG.fileNotFound };
  await drainKeys(deleted.map((d) => d.storage_key));
  revalidatePiece(deleted[0].piece_id);
  return { success: OMR_MSG.draftDeleted };
}

/** The editor's poll: the latest job's state after the read-time limits (AC 13). Managers only. */
export async function omrState(pieceId: string): Promise<string | null> {
  if (!(await assertManager())) return null;
  if (!idSchema.safeParse(pieceId).success) return null;
  await expireStale({ pieceId });
  const [r] = await db.all<{ state: string; started_at: number | null }>(sql`
    select state, started_at from omr_jobs where piece_id = ${pieceId}
    order by created_at desc, rowid desc limit 1`);
  return r ? `${r.state}:${r.started_at ?? ""}` : null;
}
