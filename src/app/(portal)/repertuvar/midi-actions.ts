"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { midiFiles, storageDeletions, VOICE_PARTS } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { assertManager } from "@/lib/auth/dal";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { storage, storageErrorKind } from "@/lib/storage/driver";
import { drainKeys, holdKey, newKey, releaseKey, releasePutFailure } from "@/lib/storage/ledger";
import { MIDI_LABEL_MAX, MIDI_MAX_BYTES, MIDI_MAX_PER_PIECE } from "@/lib/storage/limits";
import { MSG } from "@/lib/storage/messages";
import { uploadsPaused, uploadsPausedAfterHold } from "@/lib/storage/quota";
import { checkMidi } from "@/lib/storage/sniff";
import { cleanLine } from "@/lib/text";
import { now } from "@/lib/time";
import { formValues, type FormState } from "@/lib/validation";

const idSchema = z.uuid();

function revalidatePiece(pieceId: string) {
  revalidatePath(`/repertuvar/${pieceId}`);
  revalidatePath(`/repertuvar/${pieceId}/duzenle`);
  revalidatePath("/odevler", "layout");
}

async function midiOnPiece(pieceId: string) {
  const [r] = await db.all<{ exists: number; n: number }>(sql`
    select exists (select 1 from pieces where id = ${pieceId}) as "exists",
      (select count(*) from midi_files where piece_id = ${pieceId}) as n`);
  return { exists: Boolean(r?.exists), count: Number(r?.n ?? 0) };
}

/**
 * Managers add a MIDI file to a piece (D24, D32): a server action under 8b's 1100 kb body limit,
 * so a 1,048,577-byte file still reaches our own message. `uploadId` (one per form mount) makes a
 * replayed submit a no-op.
 */
export async function uploadMidi(
  pieceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: MSG.forbidden };
  if (!idSchema.safeParse(pieceId).success) return { error: MSG.pieceNotFound };
  const values = formValues(formData);
  const uploadId = idSchema.safeParse(String(formData.get("uploadId") ?? "").toLowerCase());
  if (!uploadId.success) return { error: MSG.generic, values };
  const partValue = String(formData.get("part") ?? "tutti");
  const voicePart = VOICE_PARTS.find((p) => p === partValue) ?? null;
  if (partValue !== "tutti" && !voicePart) return { error: MSG.generic, values };
  const label = cleanLine(String(formData.get("label") ?? "")).trim() || null;
  if (label && label.length > MIDI_LABEL_MAX) {
    return { fieldErrors: { label: [MSG.midiLabelTooLong] }, values };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { fieldErrors: { file: [MSG.notMidi] }, values };
  }
  // Before arrayBuffer(): never buffer what we refuse.
  if (file.size > MIDI_MAX_BYTES) return { fieldErrors: { file: [MSG.midiTooBig] }, values };

  const [replay] = await db
    .select({ pieceId: midiFiles.pieceId })
    .from(midiFiles)
    .where(eq(midiFiles.id, uploadId.data));
  if (replay) {
    return replay.pieceId === pieceId ? { success: MSG.midiUploaded } : { error: MSG.generic };
  }
  const piece = await midiOnPiece(pieceId);
  if (!piece.exists) return { error: MSG.pieceNotFound };
  if (piece.count >= MIDI_MAX_PER_PIECE) return { error: MSG.midiTooMany, values };
  const { blocked } = await consumeAttempt(`midi-upload:${actor.id}`, 30, 3_600_000);
  if (blocked) return { error: MSG.uploadRate, values };
  if (await uploadsPaused(file.size)) return { error: MSG.midiFull, values };
  const driver = await storage();
  if (!driver) return { error: MSG.disabled, values };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!checkMidi(bytes)) return { fieldErrors: { file: [MSG.notMidi] }, values };

  const key = newKey("midi", "mid");
  try {
    await holdKey(key, "midi", bytes.byteLength);
  } catch {
    return { error: MSG.generic, values };
  }
  // Again after the hold: holds count as stored, so parallel uploads see each other.
  if (await uploadsPausedAfterHold().catch(() => false)) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    return { error: MSG.midiFull, values };
  }
  try {
    await driver.put(key, bytes, "audio/midi", AbortSignal.timeout(20_000));
  } catch (error) {
    const kind = storageErrorKind(error);
    console.error("storage put failed", { driver: driver.name, kind });
    await releasePutFailure(key, kind);
    return { error: MSG.generic, values };
  }
  let refused: string | null = null;
  try {
    refused = await writeTx(async (tx) => {
      const [p] = await tx.all<{ n: number; ok: number }>(sql`
        select exists (select 1 from pieces where id = ${pieceId}) as ok,
          (select count(*) from midi_files where piece_id = ${pieceId}) as n`);
      if (!p?.ok) return MSG.pieceNotFound;
      if (Number(p.n) >= MIDI_MAX_PER_PIECE) return MSG.midiTooMany;
      const released = await tx
        .delete(storageDeletions)
        .where(and(eq(storageDeletions.storageKey, key), eq(storageDeletions.state, "pending")))
        .returning({ key: storageDeletions.storageKey });
      if (released.length !== 1) throw new Error("upload hold missing");
      await tx.insert(midiFiles).values({
        id: uploadId.data,
        pieceId,
        voicePart,
        label,
        storageKey: key,
        sizeBytes: bytes.byteLength,
        createdBy: actor.id,
        createdAt: now(),
      });
      return null;
    });
  } catch (error) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    const [winner] = await db
      .select({ pieceId: midiFiles.pieceId })
      .from(midiFiles)
      .where(eq(midiFiles.id, uploadId.data));
    if (winner?.pieceId === pieceId) return { success: MSG.midiUploaded };
    console.error("midi upload failed", { name: (error as Error)?.name });
    return { error: MSG.generic, values };
  }
  if (refused) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    return { error: refused, values };
  }
  revalidatePiece(pieceId);
  return { success: MSG.midiUploaded };
}

/** The row goes now; the trigger queues the file, deleted inline when possible (AC 54). */
export async function deleteMidi(midiId: string): Promise<FormState> {
  if (!(await assertManager())) return { error: MSG.forbidden };
  if (!idSchema.safeParse(midiId).success) return { error: MSG.fileNotFound };
  const deleted = await writeTx((tx) =>
    tx
      .delete(midiFiles)
      .where(eq(midiFiles.id, midiId))
      .returning({ key: midiFiles.storageKey, pieceId: midiFiles.pieceId }),
  );
  if (deleted.length === 0) return { error: MSG.fileNotFound };
  await drainKeys(deleted.map((d) => d.key));
  revalidatePiece(deleted[0].pieceId);
  return { success: MSG.midiDeleted };
}
