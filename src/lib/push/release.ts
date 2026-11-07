import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cut, DAY_MS, type Item } from "./copy";
import { notify } from "./dispatch";

export const RELEASE_KEY = "surum";

/**
 * After a health probe of a new build: IT users (handles_reports) get "Canlıya çıktı" once per
 * commit. The upsert changes the row only for a new sha, so concurrent probes send once.
 * Never throws: the probe must not fail or slow down because of it.
 */
export async function announceRelease(sha: string, message?: string | null) {
  try {
    const sha7 = sha.slice(0, 7);
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) return;
    const changed = await db.all<{ key: string }>(sql`
      insert into notification_state (key, value) values (${RELEASE_KEY}, ${sha})
      on conflict (key) do update set value = excluded.value, updated_at = unixepoch()
        where notification_state.value <> excluded.value
      returning key`);
    if (changed.length === 0) return;
    const firstLine = message?.split("\n")[0]?.trim();
    const it = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handlesReports, true), eq(users.isActive, true), isNull(users.leftAt)));
    const now = new Date();
    const items: Item[] = it.map((u) => ({
      userId: u.id,
      kind: "release",
      group: "sistem",
      dedupeKey: `surum-${sha7}`,
      title: "Canlıya çıktı",
      body: `Yeni sürüm canlıda · ${sha7}${firstLine ? ` · ${cut(firstLine, 80)}` : ""}`,
      line: `Yeni sürüm canlıda · ${sha7}`,
      url: "/",
      tag: "surum",
      // The release is news right now; quiet hours must not hold it until the morning digest.
      urgent: true,
      expiresAt: new Date(now.getTime() + DAY_MS),
    }));
    await notify(items, { now, fault: null, latencyMs: 0 });
  } catch (e) {
    console.error("release announcement failed", { name: (e as Error)?.name });
  }
}
