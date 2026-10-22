import "server-only";
import { cookies } from "next/headers";
import { pushHooksEnabled } from "./config";

export type Fault = "throw" | "slow" | null;
/** Request-time inputs, read before after(): "now" for timing, and the e2e fault/latency hooks. */
export type PushContext = { now: Date; fault: Fault; latencyMs: number };

export const CLOCK_COOKIE = "arkhe_e2e_clock";
export const FAULT_COOKIE = "arkhe_e2e_push_fault";
export const LATENCY_COOKIE = "arkhe_e2e_push_latency";

function parseClock(v: string | null | undefined) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseFault(v: string | null | undefined): Fault {
  return v === "throw" || v === "slow" ? v : null;
}

function parseLatency(v: string | null | undefined) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : 0;
}

/** From the request cookies (actions, pages); plain real time outside a request or in production. */
export async function pushContext(): Promise<PushContext> {
  const real: PushContext = { now: new Date(), fault: null, latencyMs: 0 };
  if (!pushHooksEnabled()) return real;
  try {
    const jar = await cookies();
    return {
      now: parseClock(jar.get(CLOCK_COOKIE)?.value) ?? real.now,
      fault: parseFault(jar.get(FAULT_COOKIE)?.value),
      latencyMs: parseLatency(jar.get(LATENCY_COOKIE)?.value),
    };
  } catch {
    return real;
  }
}

/** The cron routes' query hooks: `?simdi=`, `?hata=throw|slow|dispatcher`, `?gecikme=`. */
export function cronPushContext(url: URL): PushContext & { dispatcherFault: boolean } {
  const real = { now: new Date(), fault: null, latencyMs: 0, dispatcherFault: false };
  if (!pushHooksEnabled()) return real;
  const hata = url.searchParams.get("hata");
  return {
    now: parseClock(url.searchParams.get("simdi")) ?? real.now,
    fault: parseFault(hata),
    latencyMs: parseLatency(url.searchParams.get("gecikme")),
    dispatcherFault: hata === "dispatcher",
  };
}
