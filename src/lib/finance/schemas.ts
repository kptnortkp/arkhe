import { z } from "zod";
import { INVALID_LINK, parseLink } from "@/lib/links";
import { parseAmount } from "@/lib/money";
import { cleanText } from "@/lib/text";
import { addDays, istanbulDateOf, now } from "@/lib/time";
import { optionalLine } from "@/lib/validation";
import { ACCOUNTS, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "./categories";

export const FORBIDDEN = "Bu işlem için yetkin yok.";
export const NOT_FOUND = "Kayıt bulunamadı.";
export const STALE = "Kayıt bu arada değişti. Sayfayı yenileyip tekrar dene.";
export const ALREADY_VOID = "Bu kayıt zaten iptal edilmiş.";
export const CHECK_FAILED = "Kaydedilemedi. Alanları kontrol et.";
export const ACCOUNT_COOKIE = "arkhe_fin_hesap";
export const GENERIC = "Bir şeyler ters gitti, tekrar dene.";

// Every finance free-text field is one line (lists, CSV cells); sponsor notes use optionalText.
export const text = optionalLine;

export const amountField = z.string().transform((v, ctx) => {
  const parsed = parseAmount(v);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.error });
    return z.NEVER;
  }
  return parsed.kurus;
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isRealDay(v: string) {
  return DAY.test(v) && addDays(v, 0) === v;
}

export const dayField = z
  .string()
  .trim()
  .refine((v) => v !== "", "Tarih gir.")
  .refine((v) => v === "" || isRealDay(v), "Tarih gir.");

export const DATE_OUT_OF_RANGE = "Tarih 2000 ile gelecek iki yıl arasında olmalı.";

/** 2000-01-01 … today (Istanbul) + 730 days; today is read per call, never at module load. */
export function inDateBounds(v: string) {
  return v >= "2000-01-01" && v <= addDays(istanbulDateOf(now()), 730);
}

export const boundedDayField = dayField.refine(
  (v) => !isRealDay(v) || inDateBounds(v),
  DATE_OUT_OF_RANGE,
);

/** The opening date: bounded, and like entries at most a month ahead. */
export const openingDayField = boundedDayField.refine(
  (v) => !isRealDay(v) || v <= addDays(istanbulDateOf(now()), 31),
  "Tarih çok ileride.",
);

/** A business day for an entry: real, and at most a month ahead. */
export const entryDayField = dayField.refine(
  (v) => !isRealDay(v) || v <= addDays(istanbulDateOf(now()), 31),
  "Tarih çok ileride.",
);

export const documentField = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const link = parseLink(v);
    if (!link) {
      ctx.addIssue({ code: "custom", message: INVALID_LINK });
      return z.NEVER;
    }
    return link.url;
  });

const optionalId = z
  .string()
  .optional()
  .transform((v) => v || null)
  .pipe(z.uuid().nullable());

const common = {
  amount: amountField,
  occurredOn: entryDayField,
  account: z.enum(ACCOUNTS, "Hesap seç."),
  description: text(200),
  counterparty: text(120),
};

const incomeCategories = INCOME_CATEGORIES.filter((c) => c !== "dues");

export const entrySchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("income"),
        category: z.enum(incomeCategories, "Kategori seç."),
        sponsorId: optionalId,
        eventId: optionalId,
        documentUrl: documentField,
        ...common,
      })
      .superRefine((d, ctx) => {
        if (d.category === "sponsorship" && !d.sponsorId) {
          ctx.addIssue({ code: "custom", path: ["sponsorId"], message: "Sponsor seç." });
        }
      })
      .transform((d) => ({ ...d, sponsorId: d.category === "sponsorship" ? d.sponsorId : null })),
    z.object({
      kind: z.literal("expense"),
      category: z.enum(EXPENSE_CATEGORIES, "Kategori seç."),
      eventId: optionalId,
      documentUrl: documentField,
      ...common,
    }),
    z
      .object({
        kind: z.literal("transfer"),
        toAccount: z.enum(ACCOUNTS, "Hedef hesap seç."),
        ...common,
      })
      .refine((d) => d.toAccount !== d.account, {
        path: ["toAccount"],
        message: "Kaynak ve hedef hesap aynı olamaz.",
      }),
  ],
  { error: "Tür seç." },
);

/** What a dues correction may change: never the member or the period. */
export const duesCorrectionSchema = z.object({
  amount: amountField,
  occurredOn: entryDayField,
  account: z.enum(ACCOUNTS, "Hesap seç."),
  description: text(200),
  counterparty: text(120),
  documentUrl: documentField,
});

export const metaSchema = z.object({
  revision: z.coerce.number().int().min(0),
  description: text(200),
  counterparty: text(120),
  eventId: optionalId,
  documentUrl: documentField,
});

export const voidReason = z
  .string()
  .overwrite(cleanText)
  .trim()
  .min(5, "İptal nedeni yaz (en az 5 karakter).")
  .max(200, "En fazla 200 karakter.");

/** Same-site return path inside /finans; anything else falls back. */
export function safeReturn(raw: unknown, fallback = "/finans/hareketler") {
  return typeof raw === "string" && /^\/finans(\/[\w/-]*)?(\?[\w=&%.-]*)?$/.test(raw)
    ? raw
    : fallback;
}

/** Which SQLite constraint failed, walking the driver's cause chain; null for other errors. */
export function constraintKind(error: unknown) {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("FOREIGN KEY")) return "fk";
    if (msg.includes("UNIQUE")) return "unique";
    if (msg.includes("CHECK")) return "check";
  }
  return null;
}
