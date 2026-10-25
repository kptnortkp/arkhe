import "server-only";
import { cookies } from "next/headers";
import { isLocalDb } from "@/lib/storage/root.mjs";
import { OMR_FAULT_COOKIE } from "@/lib/storage/limits";

export type DispatchFault = "401" | "403" | "404" | "500" | "timeout";

/** e2e: what the GitHub call answers; only outside production on a local DB (the 8b rule). */
export async function dispatchFault(): Promise<DispatchFault | null> {
  if (process.env.NODE_ENV === "production" || !isLocalDb(process.env)) return null;
  try {
    const v = (await cookies()).get(OMR_FAULT_COOKIE)?.value;
    return v === "401" || v === "403" || v === "404" || v === "500" || v === "timeout" ? v : null;
  } catch {
    return null;
  }
}
