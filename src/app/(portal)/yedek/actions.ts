"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { assertUser } from "@/lib/auth/dal";
import { consumeAttempt } from "@/lib/auth/rate-limit";
import { appUrl } from "@/lib/auth/set-password-links";
import { redactionSecrets, smtpConfig } from "@/lib/backup/config";
import {
  MANUAL_SENDS_PER_HOUR,
  MAX_RECIPIENTS,
  RECIPIENT_CHANGES_PER_DAY,
} from "@/lib/backup/constants";
import { changeNoticeEmail } from "@/lib/backup/email";
import { sendMail } from "@/lib/backup/mail";
import { describeError } from "@/lib/backup/messages";
import { loadRecipients, RECIPIENTS_KEY, splitRecipients } from "@/lib/backup/recipients";
import { runMonthlyBackup } from "@/lib/backup/run";
import { RECORDING_EMAIL_RE } from "@/lib/homework/mail";
import { canManageBackup } from "@/lib/permissions";
import { istanbulDateOf, now } from "@/lib/time";
import type { FormState } from "@/lib/validation";

const NOT_CONDUCTOR_SAVE = "Bu ayarı yalnızca koro şefi değiştirebilir.";
const NOT_CONDUCTOR_SEND = "Bu işlemi yalnızca koro şefi yapabilir.";
const TOO_MANY = "En fazla beş adres ekleyebilirsin.";
const NONE = "En az bir adres gir.";
const SAVED = "Alıcılar kaydedildi.";
const NOTICE_FAILED = "Bilgi e-postası gönderilemedi. Eski ve yeni alıcılara sen haber ver.";
const CHANGES_THROTTLED = "Alıcılar bugün çok sık değişti. Yarın yeniden dene.";
const NO_RECIPIENTS = "Önce en az bir alıcı kaydet.";
const SENDS_THROTTLED = "Çok fazla deneme. Bir saat sonra yeniden dene.";
const RUNNING = "Şu anda bir gönderim sürüyor. Birkaç dakika sonra yeniden dene.";
const FAILED = "Gönderilemedi. Ayrıntı aşağıda, Geçmiş'te.";
// More raw rows than this is a crafted request; the form never renders more than five.
const MAX_RAW_ROWS = 10;
const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;

function revalidateBackup() {
  revalidatePath("/yedek");
  revalidatePath("/");
}

/**
 * Field errors are keyed `recipients.<i>`, i = index in the submitted list (empties included).
 * `values` echoes the canonical list as `recipients` ("a@x.org,b@y.org") on success.
 */
export async function saveBackupRecipients(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await assertUser();
  if (!user || !canManageBackup(user.role)) return { error: NOT_CONDUCTOR_SAVE };

  const raw = formData.getAll("recipients");
  if (raw.length > MAX_RAW_ROWS || raw.some((v) => typeof v !== "string"))
    return { error: TOO_MANY };
  const entries = (raw as string[]).map((v) => v.trim().toLowerCase());
  const fieldErrors: Record<string, string[]> = {};
  entries.forEach((v, i) => {
    if (v && (v.length > 254 || !RECORDING_EMAIL_RE.test(v))) {
      fieldErrors[`recipients.${i}`] = [`Geçerli bir e-posta adresi gir: ${v.slice(0, 64)}`];
    }
  });
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  const list = [...new Set(entries.filter(Boolean))];
  if (list.length === 0) return { error: NONE };
  if (list.length > MAX_RECIPIENTS) return { error: TOO_MANY };
  const canonical = list.join(",");

  const before = await loadRecipients();
  const beforeValue = before?.list.join(",") ?? null;
  if (beforeValue === canonical) return { success: SAVED, values: { recipients: canonical } };
  // First saves and identical saves don't count against the daily limit.
  if (beforeValue !== null) {
    const { blocked } = await consumeAttempt(
      `backup-recipients:${user.id}`,
      RECIPIENT_CHANGES_PER_DAY,
      DAY_MS,
    );
    if (blocked) return { error: CHANGES_THROTTLED };
  }

  const at = now();
  // Read and write in one transaction, so the notice names exactly the list this save replaced.
  const replaced = await db.transaction(async (tx) => {
    const [old] = await tx
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, RECIPIENTS_KEY));
    await tx
      .insert(appSettings)
      .values({ key: RECIPIENTS_KEY, value: canonical, updatedAt: at, updatedBy: user.id })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: canonical, updatedAt: at, updatedBy: user.id },
      });
    return old?.value ?? null;
  });
  revalidateBackup();
  const result: FormState = { success: SAVED, values: { recipients: canonical } };
  if (replaced === null || replaced === canonical) return result;

  const old = splitRecipients(replaced);
  const to = [...new Set([...old, ...list])];
  try {
    const notice = changeNoticeEmail({
      actorName: user.name,
      at,
      recipients: list,
      pageUrl: appUrl("/yedek"),
    });
    await sendMail(smtpConfig(process.env), { to, ...notice }, "alici-degisti");
  } catch (e) {
    // A broken SMTP must never block fixing the list, so the save stands.
    console.error(
      "backup recipients notice failed",
      describeError(e, [...redactionSecrets(process.env), ...to]),
    );
    return { ...result, warning: NOTICE_FAILED };
  }
  return result;
}

export async function sendBackupNow(): Promise<FormState> {
  const user = await assertUser();
  if (!user || !canManageBackup(user.role)) return { error: NOT_CONDUCTOR_SEND };
  if (!(await loadRecipients())) return { error: NO_RECIPIENTS };
  const { blocked } = await consumeAttempt(
    `backup-send:${user.id}`,
    MANUAL_SENDS_PER_HOUR,
    HOUR_MS,
  );
  if (blocked) return { error: SENDS_THROTTLED };

  const outcome = await runMonthlyBackup({
    trigger: "manual",
    today: istanbulDateOf(now()),
    actor: { id: user.id, name: user.name },
  });
  revalidateBackup();
  if (outcome.result === "sent") return { success: `Gönderildi: ${outcome.recipients} adres.` };
  if (outcome.result === "failed") return { error: FAILED };
  switch (outcome.refusal) {
    case "no-recipients":
      return { error: NO_RECIPIENTS };
    case "running":
      return { error: RUNNING };
    default:
      return {
        error: `Az önce gönderildi. ${outcome.minutesLeft ?? 1} dakika sonra yeniden gönderebilirsin.`,
      };
  }
}
