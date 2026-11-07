"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ISSUE_CLOSED_STATUSES, ISSUE_STATUSES, type IssueStatus } from "@/db/schema";
import { writeTx } from "@/db/write-tx";
import { assertUser } from "@/lib/auth/dal";
import { reportUpdated } from "@/lib/push/reports";
import { REPORT_MSG, REPORT_REPLY_MAX } from "@/lib/reports/labels";
import { isReportHandler } from "@/lib/reports/queries";
import { MSG } from "@/lib/storage/messages";

export type UpdateReportState = {
  error?: string;
  success?: string;
  fieldErrors?: { reply?: string[] };
};

const schema = z.object({
  number: z.coerce.number().int().min(1),
  status: z.enum(ISSUE_STATUSES),
  reply: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(REPORT_REPLY_MAX, REPORT_MSG.replyLong))
    .transform((s) => (s.length > 0 ? s : null)),
});

const closed = (s: IssueStatus) => (ISSUE_CLOSED_STATUSES as readonly string[]).includes(s);

/** The handler's one save: status and reply together. Anyone else gets "not found". */
export async function updateReport(
  _prev: UpdateReportState,
  formData: FormData,
): Promise<UpdateReportState> {
  const user = await assertUser();
  if (!user) return { error: MSG.auth };
  if (!(await isReportHandler(user.id))) return { error: REPORT_MSG.notFound };
  const parsed = schema.safeParse({
    number: formData.get("number"),
    status: formData.get("status"),
    reply: formData.get("reply") ?? "",
  });
  if (!parsed.success) {
    const f = z.flattenError(parsed.error).fieldErrors;
    return f.reply ? { fieldErrors: { reply: f.reply } } : { error: MSG.generic };
  }
  const { number, status, reply } = parsed.data;
  const result = await writeTx(async (tx) => {
    const [r] = await tx.all<{
      status: IssueStatus;
      reply: string | null;
      reporter_id: string;
      closed_at: number | null;
    }>(sql`select status, reply, reporter_id, closed_at from issue_reports where number = ${number}`);
    if (!r) return null;
    const statusChanged = r.status !== status;
    const replyChanged = (r.reply ?? null) !== reply;
    if (!statusChanged && !replyChanged) return { changed: false as const };
    const at = Math.floor(Date.now() / 1000);
    // Closing starts the 90-day image clock; done -> wontfix keeps it, reopening clears it.
    const closedAt = closed(status) ? (closed(r.status) ? r.closed_at : at) : null;
    await tx.run(sql`
      update issue_reports set status = ${status}, reply = ${reply}, closed_at = ${closedAt},
        updated_at = ${at}
      where number = ${number}`);
    return { changed: true as const, reporterId: r.reporter_id, replyChanged };
  });
  if (!result) return { error: REPORT_MSG.notFound };
  if (!result.changed) return { success: REPORT_MSG.unchanged };
  await reportUpdated(
    { number, reporterId: result.reporterId, status, reply },
    { actorId: user.id, replyChanged: result.replyChanged },
  );
  revalidatePath("/sorunlar");
  revalidatePath(`/sorunlar/${number}`);
  revalidatePath("/sorun-bildir");
  return { success: REPORT_MSG.saved };
}
