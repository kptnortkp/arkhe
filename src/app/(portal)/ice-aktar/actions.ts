"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { assertManager } from "@/lib/auth/dal";
import { GENERIC } from "@/lib/finance/schemas";
import { FAULT_COOKIE, isSlug, TOO_BIG, IMPORT_MAX_BYTES } from "@/lib/import/limits";
import { checkFile, commitFile, type Upload } from "@/lib/import/run";
import type { CheckResult, CommitResult } from "@/lib/import/types";
import { undoBatch } from "@/lib/import/undo";
import type { FormState } from "@/lib/validation";

const FORBIDDEN = "Bu işlem için yetkin yok.";
const BAD_REQUEST = "Dosya okunamadı. Yeniden seç ve tekrar dene.";

async function uploadOf(formData: unknown): Promise<Upload | string> {
  if (!(formData instanceof FormData)) return BAD_REQUEST;
  const file = formData.get("file");
  if (!(file instanceof File)) return BAD_REQUEST;
  // Checked before reading a byte: a crafted request skips the client's own check.
  if (file.size > IMPORT_MAX_BYTES) return TOO_BIG;
  return { name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
}

const fileError = (message: string) => ({
  kind: "fileError" as const,
  file: null,
  message,
  messages: [message],
});

/** Logs only the error's name and code (never cell values); the user gets the generic sentence. */
function failed(op: string, slug: string, error: unknown) {
  const e = error as { name?: string; code?: string };
  console.error("import failed", { op, slug, name: e?.name, code: e?.code });
}

/** Kontrol et: parses and validates against the live data; writes nothing (AC 15). */
export async function checkImport(slug: string, formData: FormData): Promise<CheckResult> {
  const actor = await assertManager();
  if (!actor) return { kind: "denied", message: FORBIDDEN };
  if (!isSlug(slug)) return fileError(BAD_REQUEST);
  const upload = await uploadOf(formData);
  if (typeof upload === "string") return fileError(upload);
  try {
    return await checkFile(actor, slug, upload);
  } catch (error) {
    failed("check", slug, error);
    return fileError(GENERIC);
  }
}

/** AC 19's test hook: only outside production and only against a local file database. */
async function faultAt() {
  if (process.env.NODE_ENV === "production") return null;
  if (!(process.env.DATABASE_URL ?? "file:data/arkhe.db").startsWith("file:")) return null;
  const n = Number((await cookies()).get(FAULT_COOKIE)?.value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** İçe aktar: the same file again with the previewed hash; all rows or none. */
export async function commitImport(slug: string, formData: FormData): Promise<CommitResult> {
  const actor = await assertManager();
  if (!actor) return { kind: "denied", message: FORBIDDEN };
  if (!isSlug(slug)) return fileError(BAD_REQUEST);
  const upload = await uploadOf(formData);
  if (typeof upload === "string") return fileError(upload);
  let result: CommitResult;
  try {
    result = await commitFile(actor, slug, upload, {
      previewedSha: formData.get("sha256"),
      faultAt: await faultAt(),
    });
  } catch (error) {
    // The transaction rolled back: nothing of this file was written (AC 19).
    failed("commit", slug, error);
    return fileError(GENERIC);
  }
  if (result.kind === "done") revalidatePath("/", "layout");
  return result;
}

export async function undoImport(batchId: number): Promise<FormState> {
  const actor = await assertManager();
  if (!actor) return { error: FORBIDDEN };
  const id = z.number().int().positive().safeParse(batchId);
  if (!id.success) return { error: "Bu içe aktarma bulunamadı." };
  let result: FormState;
  try {
    result = await undoBatch(actor, id.data);
  } catch (error) {
    failed("undo", "", error);
    return { error: GENERIC };
  }
  if ("success" in result) revalidatePath("/", "layout");
  return result;
}
