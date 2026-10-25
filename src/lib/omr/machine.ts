import "server-only";
import { z } from "zod";
import { omrMode } from "./config";
import { headersPlausible, signatureValid } from "./signature";

const BASE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

/** Machine answers carry a code only, never a hint about the secret or the job. */
export function machine(status: number, code?: string) {
  return code
    ? Response.json({ code }, { status, headers: BASE })
    : new Response(null, { status, headers: BASE });
}

async function readCapped(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * D98 for every workflow request: 503 when not configured, 401 for a missing, stale or wrong
 * signature, 413 above `maxBytes` (before parsing), 404 for an id that isn't a uuid. The order
 * keeps an unsigned caller from learning anything about jobs.
 */
export async function authenticate(
  request: Request,
  jobId: string,
  maxBytes: number,
): Promise<{ body: Uint8Array } | Response> {
  const mode = omrMode();
  if (mode.mode === "off") return machine(503, "not_configured");
  if (!headersPlausible(request.headers, Math.floor(Date.now() / 1000))) return machine(401);
  const length = request.headers.get("content-length");
  if (request.method === "POST" && length === null) return machine(411);
  const declared = Number(length);
  if (Number.isFinite(declared) && declared > maxBytes) return machine(413);
  let body: Uint8Array | null;
  try {
    body = await readCapped(request, maxBytes);
  } catch {
    return machine(400);
  }
  if (body === null) return machine(413);
  const path = new URL(request.url).pathname;
  if (!signatureValid(mode.secret, request.headers, request.method, path, body)) return machine(401);
  if (!z.uuid().safeParse(jobId).success) return machine(404);
  return { body };
}

export function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return undefined;
  }
}
