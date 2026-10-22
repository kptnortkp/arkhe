import "server-only";
import { cookies } from "next/headers";
import { MAX_DURATION_MS, RECORDER_LIMIT_COOKIE, STORAGE_FAULT_COOKIE } from "./limits";
import { isLocalDb } from "./root.mjs";

export type StorageOp = "put" | "get" | "delete";

/** Test hooks run only outside production and against a local file database (the 8b rule). */
function hooksEnabled() {
  return process.env.NODE_ENV !== "production" && isLocalDb(process.env);
}

async function cookieValue(name: string) {
  try {
    return (await cookies()).get(name)?.value ?? null;
  } catch {
    // Outside a request (scripts): no hooks.
    return null;
  }
}

/** e2e: `arkhe_e2e_storage_fault=put|get|delete` makes that storage operation fail. */
export async function storageFault(): Promise<StorageOp | null> {
  if (!hooksEnabled()) return null;
  const v = await cookieValue(STORAGE_FAULT_COOKIE);
  return v === "put" || v === "get" || v === "delete" ? v : null;
}

/** The recorder's hard stop in ms; e2e may shorten it with `arkhe_e2e_recorder_limit=<1–600>` s. */
export async function recorderMaxMs() {
  if (!hooksEnabled()) return MAX_DURATION_MS;
  const n = Number(await cookieValue(RECORDER_LIMIT_COOKIE));
  return Number.isInteger(n) && n >= 1 && n <= 600 ? n * 1000 : MAX_DURATION_MS;
}
