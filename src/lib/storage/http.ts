import "server-only";
import type { UploadCode } from "./limits";

const BASE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** 401/404/410 without a body: no hint about whether a recording exists (AC 3). */
export function empty(status: number) {
  return new Response(null, { status, headers: BASE });
}

export function fail(status: number, error: string, code: UploadCode) {
  return Response.json({ error, code }, { status, headers: BASE });
}

export function ok(body: unknown, status = 200) {
  return Response.json(body, { status, headers: BASE });
}

/** Headers of every file response (D16); the type is ours, never the store's. */
export function fileHeaders(opts: {
  type: string;
  /** null = unknown: the body streams without a length, never with a wrong one. */
  size: number | null;
  cache: string;
  attachment: string | null;
}): Record<string, string> {
  return {
    "Content-Type": opts.type,
    ...(opts.size ? { "Content-Length": String(opts.size) } : {}),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": opts.cache,
    "Accept-Ranges": "none",
    "Content-Disposition": opts.attachment ? `attachment; filename="${opts.attachment}"` : "inline",
  };
}

/** A timeout for getting the object, cleared once the stream starts (a slow client isn't cut off). */
export function startTimeout(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
