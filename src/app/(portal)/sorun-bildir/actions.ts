"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeTx } from "@/db/write-tx";
import { assertUser } from "@/lib/auth/dal";
import { consumeAttempt, forgetAttempt } from "@/lib/auth/rate-limit";
import { reportFiled } from "@/lib/push/reports";
import {
  REPORT_BODY_MAX,
  REPORT_MSG,
  REPORT_TITLE_MAX,
  REPORT_TITLE_MIN,
  REPORTS_PER_DAY,
  sentMessage,
} from "@/lib/reports/labels";
import { MSG } from "@/lib/storage/messages";

export type CreateReportResult =
  | { ok: true; id: string; number: number; message: string }
  | { ok: false; error?: string; fieldErrors?: { title?: string[]; body?: string[] } };

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Only a same-site path; the query string and fragment are dropped. */
function cleanPage(v: unknown) {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//")) return null;
  try {
    const path = new URL(v, "http://x").pathname.slice(0, 300);
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

function cleanDevice(v: unknown) {
  if (typeof v !== "string") return null;
  const s = oneLine(v).slice(0, 300);
  return s.length > 0 ? s : null;
}

const schema = z.object({
  title: z
    .string()
    .transform(oneLine)
    .pipe(
      z
        .string()
        .min(REPORT_TITLE_MIN, REPORT_MSG.titleShort)
        .max(REPORT_TITLE_MAX, REPORT_MSG.titleLong),
    )
    // The DB counts characters, zod UTF-16 units: two emoji pass min(3) but not the CHECK.
    .refine((s) => [...s].length >= REPORT_TITLE_MIN, REPORT_MSG.titleShort),
  body: z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1, REPORT_MSG.bodyEmpty).max(REPORT_BODY_MAX, REPORT_MSG.bodyLong)),
  page: z.unknown().transform(cleanPage),
  device: z.unknown().transform(cleanDevice),
});

const isUnique = (e: unknown) => {
  for (let x = e; x; x = (x as { cause?: unknown }).cause) {
    if (x instanceof Error && x.message.includes("UNIQUE constraint failed")) return true;
  }
  return false;
};

/** Any signed-in user files a report; screenshots follow through /api/dosya/sorun. */
export async function createReport(input: unknown): Promise<CreateReportResult> {
  const user = await assertUser();
  if (!user) return { ok: false, error: MSG.auth };
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const f = z.flattenError(parsed.error).fieldErrors;
    return { ok: false, fieldErrors: { title: f.title, body: f.body } };
  }
  const { title, body, page, device } = parsed.data;
  const { blocked, attemptId } = await consumeAttempt(
    `report:${user.id}`,
    REPORTS_PER_DAY,
    86_400_000,
  );
  if (blocked) return { ok: false, error: REPORT_MSG.rate };

  const id = crypto.randomUUID();
  const insert = () =>
    writeTx(async (tx) => {
      const [row] = await tx.all<{ n: number }>(
        sql`select coalesce(max(number), 0) + 1 as n from issue_reports`,
      );
      const number = Number(row.n);
      const at = Math.floor(Date.now() / 1000);
      await tx.run(sql`
        insert into issue_reports (id, number, reporter_id, title, body, page, device, created_at, updated_at)
        values (${id}, ${number}, ${user.id}, ${title}, ${body}, ${page}, ${device}, ${at}, ${at})`);
      return number;
    });
  let number: number;
  try {
    number = await insert().catch((e) => (isUnique(e) ? insert() : Promise.reject(e)));
  } catch (error) {
    await forgetAttempt(attemptId).catch(() => {});
    console.error("report create failed", { name: (error as Error)?.name });
    return { ok: false, error: MSG.generic };
  }
  await reportFiled({ number, title }, { id: user.id, name: user.name });
  revalidatePath("/sorun-bildir");
  console.log("report filed", { number });
  return { ok: true, id, number, message: sentMessage(number) };
}
