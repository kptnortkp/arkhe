import { sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { after, connection } from "next/server";
import { db } from "@/db";
import { pushHooksEnabled } from "@/lib/push/config";
import { announceRelease } from "@/lib/push/release";

const TIMEOUT_MS = 3000;
// The deploy workflow waits until this names the commit it pushed.
const headers = {
  "Cache-Control": "no-store",
  "X-Arkhe-Commit": (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
};

/** e2e only (local DB, not production): `arkhe_e2e_commit=<sha>` stands in for the deployed commit. */
async function deployedCommit() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA ?? null;
  if (!pushHooksEnabled()) return { sha: fromEnv, message: process.env.VERCEL_GIT_COMMIT_MESSAGE };
  const jar = await cookies();
  return {
    sha: jar.get("arkhe_e2e_commit")?.value ?? fromEnv,
    message: jar.get("arkhe_e2e_commit_message")?.value ?? process.env.VERCEL_GIT_COMMIT_MESSAGE,
  };
}

/** Readiness probe: fixed bodies only, the reason for a failure goes to the server log. */
export async function GET() {
  await connection();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), TIMEOUT_MS);
  });
  try {
    await Promise.race([db.run(sql`select 1`), timeout]);
    // The deploy workflow polls this after each deploy: IT hears about a new build once.
    try {
      const { sha, message } = await deployedCommit();
      if (sha && sha !== "local") after(() => announceRelease(sha, message));
    } catch (error) {
      console.error("release check failed", { name: (error as Error)?.name });
    }
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    console.error("health check failed", error);
    return Response.json({ ok: false }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
