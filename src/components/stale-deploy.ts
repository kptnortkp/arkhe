"use client";

import { unstable_isUnrecognizedActionError } from "next/navigation";

export const STALE_MESSAGE = "Portal güncellendi, sayfa yenileniyor…";
const KEY = "arkhe-stale-reload";

export const isStale = (error: unknown) => unstable_isUnrecognizedActionError(error);

/**
 * A page left open across a deploy called a server action the new build doesn't have.
 * Reload once to pick up the new build; true when a reload is on its way.
 */
export function reloadIfStale(error: unknown) {
  if (!isStale(error)) return false;
  try {
    // A second miss within a minute of reloading is not staleness: don't loop.
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {}
  location.reload();
  return true;
}
