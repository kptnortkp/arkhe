import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";

const TIMEOUT_MS = 3000;
const headers = { "Cache-Control": "no-store" };

/** Readiness probe: fixed bodies only, the reason for a failure goes to the server log. */
export async function GET() {
  await connection();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("health check timed out")), TIMEOUT_MS);
  });
  try {
    await Promise.race([db.run(sql`select 1`), timeout]);
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    console.error("health check failed", error);
    return Response.json({ ok: false }, { status: 503, headers });
  } finally {
    clearTimeout(timer);
  }
}
