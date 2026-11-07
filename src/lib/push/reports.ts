import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, type IssueStatus } from "@/db/schema";
import { ISSUE_STATUS_LABELS } from "@/lib/reports/labels";
import { pushContext } from "./context";
import { cut, DAY_MS, type Item } from "./copy";
import { notify } from "./dispatch";

/** Like the other triggers: a notification problem is logged, never thrown (D68). */
async function send(name: string, build: (now: Date) => Promise<Item[]>) {
  try {
    const ctx = await pushContext();
    await notify(await build(ctx.now), ctx);
  } catch (e) {
    console.error("push trigger failed", { trigger: name, name: (e as Error)?.name });
  }
}

/** A new report reaches every handler (group `sistem`), never its own reporter. */
export function reportFiled(
  report: { number: number; title: string },
  reporter: { id: string; name: string },
) {
  return send("report_new", async (now) => {
    const handlers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.handlesReports, true), eq(users.isActive, true), isNull(users.leftAt)));
    const no = report.number;
    return handlers
      .filter((h) => h.id !== reporter.id)
      .map((h) => ({
        userId: h.id,
        kind: "report_new",
        group: "sistem",
        dedupeKey: `sorun-${no}`,
        title: "Yeni sorun bildirimi",
        body: `#${no} · ${report.title} — ${reporter.name}`,
        line: `Sorun #${no}: ${report.title}`,
        url: `/sorunlar/${no}`,
        tag: `sorun-${no}`,
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      }));
  });
}

/** Status or reply changed: the reporter always gets it (their own report, group null). */
export function reportUpdated(
  report: { number: number; reporterId: string; status: IssueStatus; reply: string | null },
  opts: { actorId: string; replyChanged: boolean },
) {
  return send("report_updated", async (now) => {
    if (report.reporterId === opts.actorId) return [];
    const no = report.number;
    const status = ISSUE_STATUS_LABELS[report.status];
    const reply = opts.replyChanged && report.reply ? ` · ${cut(report.reply, 80)}` : "";
    return [
      {
        userId: report.reporterId,
        kind: "report_updated",
        group: null,
        dedupeKey: `sorun-guncel-${no}-${crypto.randomUUID()}`,
        title: `Sorun #${no} güncellendi`,
        body: `${status}${reply}`,
        line: `Sorun #${no}: ${status}`,
        url: "/sorun-bildir",
        tag: `sorun-${no}`,
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      },
    ];
  });
}
