import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { connection } from "next/server";
import { storageDeletions } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { OMR_MEASURES_MAX, OMR_RESULT_MAX_BYTES } from "@/lib/omr/constants";
import { expireStale, jobById } from "@/lib/omr/jobs";
import { authenticate, machine, parseJson } from "@/lib/omr/machine";
import { summarizeMidi } from "@/lib/omr/midi";
import { storage, storageErrorKind } from "@/lib/storage/driver";
import { drainKeys, holdKey, newKey, releaseKey, releasePutFailure } from "@/lib/storage/ledger";
import { MIDI_MAX_BYTES } from "@/lib/storage/limits";
import { uploadsPausedAfterHold } from "@/lib/storage/quota";
import { checkMidi } from "@/lib/storage/sniff";
import { now } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 30;

class Conflict extends Error {}

function decodeMidi(v: unknown) {
  if (typeof v !== "string" || v.length === 0 || v.length > Math.ceil(MIDI_MAX_BYTES / 3) * 4) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const bytes = new Uint8Array(Buffer.from(v, "base64"));
  return bytes.byteLength > 0 && bytes.byteLength <= MIDI_MAX_BYTES ? bytes : null;
}

/**
 * `{ midi: <base64>, summary: { measures, ... } }` from the workflow (AC 4, AC 17). Valid → one
 * automatic draft on the piece (replacing an undecided one) and the job `succeeded`. Invalid →
 * the job `failed / output_invalid` and nothing stored. Only while the job isn't final.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/omr/[id]/sonuc">) {
  await connection();
  const { id } = await params;
  const auth = await authenticate(request, id, OMR_RESULT_MAX_BYTES);
  if (auth instanceof Response) return auth;
  await expireStale({ jobId: id });
  const job = await jobById(id);
  if (!job) return machine(404);
  if (job.state !== "queued" && job.state !== "running") return machine(409, "state");

  const body = parseJson(auth.body) as { midi?: unknown; summary?: unknown } | undefined;
  const summary = body && typeof body === "object" ? (body.summary as { measures?: unknown } | undefined) : undefined;
  const measures = summary && typeof summary === "object" ? summary.measures : undefined;
  const bytes = body && typeof body === "object" ? decodeMidi(body.midi) : null;
  const read = bytes && checkMidi(bytes) ? summarizeMidi(bytes) : null;
  const measuresOk = Number.isInteger(measures) && (measures as number) >= 1 && (measures as number) <= OMR_MEASURES_MAX;
  const t = Math.floor(now().getTime() / 1000);
  if (!bytes || !read || !measuresOk) {
    const res = await writeTx((tx) =>
      tx.run(sql`update omr_jobs set state = 'failed', error_kind = 'output_invalid', finished_at = ${t}
                 where id = ${id} and state in ('queued', 'running')`),
    );
    if (res.rowsAffected === 0) return machine(409, "state");
    console.log("omr job state", { job: id, state: "failed", kind: "output_invalid" });
    revalidatePath(`/repertuvar/${job.pieceId}/duzenle`);
    return machine(422, "output_invalid");
  }

  const driver = await storage();
  if (!driver) return machine(503, "storage");
  const key = newKey("midi", "mid");
  try {
    await holdKey(key, "midi", bytes.byteLength);
  } catch {
    return machine(503, "storage");
  }
  if (await uploadsPausedAfterHold().catch(() => false)) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    // The upload pause won't lift within the workflow's retries: say so instead of output_invalid.
    await writeTx((tx) =>
      tx.run(sql`update omr_jobs set state = 'failed', error_kind = 'storage_full', finished_at = ${t}
                 where id = ${id} and state in ('queued', 'running')`),
    );
    console.log("omr job state", { job: id, state: "failed", kind: "storage_full" });
    revalidatePath(`/repertuvar/${job.pieceId}/duzenle`);
    return machine(507, "storage_full");
  }
  try {
    await driver.put(key, bytes, "audio/midi", AbortSignal.timeout(20_000));
  } catch (error) {
    const kind = storageErrorKind(error);
    console.error("storage put failed", { driver: driver.name, kind });
    await releasePutFailure(key, kind);
    return machine(503, "storage");
  }

  let replaced: string[] = [];
  try {
    replaced = await writeTx(async (tx) => {
      const [j] = await tx.all<{ state: string; created_by: string | null; piece: number }>(sql`
        select state, created_by, exists (select 1 from pieces where id = ${job.pieceId}) as piece
        from omr_jobs where id = ${id}`);
      if (!j || (j.state !== "queued" && j.state !== "running") || !Number(j.piece)) throw new Conflict();
      const creator =
        j.created_by ??
        (await tx.all<{ id: string }>(sql`select id from users where role = 'conductor' order by created_at limit 1`))[0]?.id;
      if (!creator) throw new Conflict();
      const old = await tx.all<{ storage_key: string }>(sql`
        delete from midi_files where piece_id = ${job.pieceId} and auto = 1 and status = 'draft'
        returning storage_key`);
      const released = await tx
        .delete(storageDeletions)
        .where(and(eq(storageDeletions.storageKey, key), eq(storageDeletions.state, "pending")))
        .returning({ key: storageDeletions.storageKey });
      if (released.length !== 1) throw new Error("upload hold missing");
      await tx.run(sql`
        insert into midi_files (id, piece_id, voice_part, label, storage_key, size_bytes, created_by,
          created_at, auto, status, tracks_json, measures, duration_sec)
        values (${crypto.randomUUID()}, ${job.pieceId}, null, 'Otomatik', ${key}, ${bytes.byteLength},
          ${creator}, ${t}, 1, 'draft', ${JSON.stringify(read.tracks)}, ${measures as number},
          ${read.durationSec})`);
      await tx.run(sql`update omr_jobs set state = 'succeeded', finished_at = ${t} where id = ${id}`);
      return old.map((o) => o.storage_key);
    });
  } catch (error) {
    await releaseKey(key).catch(() => {});
    await drainKeys([key]);
    if (error instanceof Conflict) return machine(409, "state");
    console.error("omr result failed", { job: id, name: (error as Error)?.name });
    return machine(500);
  }
  await drainKeys(replaced);
  console.log("omr job state", { job: id, state: "succeeded" });
  revalidatePath(`/repertuvar/${job.pieceId}/duzenle`);
  return machine(201, "ok");
}
