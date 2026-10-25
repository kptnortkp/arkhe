import "server-only";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OmrLayout } from "./constants";
import { omrMode } from "./config";
import { dispatchFault } from "./hooks";

export type DispatchInput = { id: string; layout: OmrLayout; piano: boolean; tempo: number | null };
export type DispatchError = "dispatch_auth" | "dispatch_failed";

export const OUTBOX_DIR = path.join(process.cwd(), "data/omr-outbox");

const authStatus = (status: number) => status === 401 || status === 403 || status === 404;

/**
 * D98/D100: workflow_dispatch with a 10 s timeout. Inputs carry nothing secret and no URL; outside
 * production the request becomes data/omr-outbox/<jobId>.json and nothing goes to the network.
 * Never logs the token or GitHub's response body.
 */
export async function dispatchJob(job: DispatchInput): Promise<DispatchError | null> {
  const mode = omrMode();
  if (mode.mode === "off") return "dispatch_failed";
  const body = {
    ref: mode.ref,
    inputs: {
      job_id: job.id,
      layout: job.layout,
      piano: job.piano ? "true" : "false",
      tempo: job.tempo === null ? "" : String(job.tempo),
    },
  };
  const fault = await dispatchFault();
  if (fault) return fault === "500" || fault === "timeout" ? "dispatch_failed" : "dispatch_auth";
  if (mode.mode === "outbox") {
    try {
      await mkdir(OUTBOX_DIR, { recursive: true });
      const file = path.join(OUTBOX_DIR, `${job.id}.json`);
      await writeFile(`${file}.tmp`, JSON.stringify(body));
      await rename(`${file}.tmp`, file);
      return null;
    } catch (error) {
      console.error("omr outbox write failed", { job: job.id, name: (error as Error)?.name });
      return "dispatch_failed";
    }
  }
  try {
    const res = await fetch(
      `https://api.github.com/repos/${mode.repo}/actions/workflows/${encodeURIComponent(mode.workflow)}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${mode.token}`,
          "Content-Type": "application/json",
          "User-Agent": "arkhe-portal",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
    await res.body?.cancel().catch(() => {});
    if (res.status === 204 || res.status === 200) return null;
    console.error("omr dispatch refused", { job: job.id, status: res.status });
    return authStatus(res.status) ? "dispatch_auth" : "dispatch_failed";
  } catch (error) {
    console.error("omr dispatch failed", { job: job.id, name: (error as Error)?.name });
    return "dispatch_failed";
  }
}
