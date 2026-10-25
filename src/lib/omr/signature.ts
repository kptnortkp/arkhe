import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { OMR_SKEW_SECONDS } from "./constants";

export const TIMESTAMP_HEADER = "x-arkhe-timestamp";
export const SIGNATURE_HEADER = "x-arkhe-signature";

/** D98: hex(HMAC-SHA256(secret, "<timestamp>.<METHOD>.<path>.<sha256(body)>")). */
export function signOmr(secret: string, ts: string, method: string, path: string, body: Uint8Array) {
  const digest = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`${ts}.${method}.${path}.${digest}`).digest("hex");
}

/** The headers alone: a timestamp within ±5 min and a well-formed signature. */
export function headersPlausible(headers: Headers, nowSec: number) {
  const ts = headers.get(TIMESTAMP_HEADER) ?? "";
  const sig = headers.get(SIGNATURE_HEADER) ?? "";
  if (!/^\d{1,12}$/.test(ts) || !/^[0-9a-f]{64}$/.test(sig)) return false;
  return Math.abs(nowSec - Number(ts)) <= OMR_SKEW_SECONDS;
}

export function signatureValid(
  secret: string,
  headers: Headers,
  method: string,
  path: string,
  body: Uint8Array,
) {
  const ts = headers.get(TIMESTAMP_HEADER) ?? "";
  const sig = headers.get(SIGNATURE_HEADER) ?? "";
  const want = Buffer.from(signOmr(secret, ts, method, path, body), "hex");
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
