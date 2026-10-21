import { z } from "zod";
import { ROLES, VOICE_PARTS } from "@/db/schema";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import { cleanLine, cleanText } from "@/lib/text";
import { istanbulToUtc } from "@/lib/time";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Geçerli bir e-posta adresi gir."));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalı.`)
  .max(128, "Şifre en fazla 128 karakter olabilir.");

export const nameSchema = z
  .string()
  .overwrite(cleanLine)
  .trim()
  .min(2, "Ad soyad en az 2 karakter olmalı.")
  .max(80, "Ad soyad çok uzun.");

export const phoneSchema = z
  .string()
  .trim()
  .max(20, "Telefon numarası çok uzun.")
  .regex(/^[0-9 +()-]*$/, "Telefon numarası sadece rakam içermeli.")
  .transform((v) => v || null);

export const memberSchema = z
  .object({
    name: nameSchema,
    email: emailSchema,
    phone: phoneSchema,
    role: z.enum(ROLES, "Bir rol seç."),
    voicePart: z
      .enum([...VOICE_PARTS, ""], "Bir partisyon seç.")
      .optional()
      .transform((v) => v || null),
    joinedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Bir tarih seç.")
      .transform((v) => istanbulToUtc(v)),
  })
  .refine((d) => d.role === "conductor" || d.voicePart !== null, {
    message: "Koristler ve yönetim kurulu için partisyon seçmek gerekli.",
    path: ["voicePart"],
  });

export const optionalText = (max: number) =>
  z
    .string()
    .overwrite(cleanText)
    .trim()
    .max(max, `En fazla ${max} karakter.`)
    .optional()
    .transform((v) => v || null);

/** As optionalText, for one-line fields (titles, names, places): line breaks become spaces. */
export const optionalLine = (max: number) =>
  z
    .string()
    .overwrite(cleanLine)
    .trim()
    .max(max, `En fazla ${max} karakter.`)
    .optional()
    .transform((v) => v || null);

export const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((d) => d.password === d.confirm, {
    message: "Şifreler eşleşmiyor.",
    path: ["confirm"],
  });

export type FormState = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  success?: string;
  // A side effect failed after the main write succeeded; shown next to the success toast.
  warning?: string;
  // Bulk saves report errors per pasted row, keyed by the row's index.
  rowErrors?: Record<number, string>;
  // Echoed back because React resets the form after an action.
  values?: Record<string, string>;
};

export function formValues(formData: FormData, omit: string[] = []) {
  const values: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !omit.includes(key) && !key.startsWith("$"))
      values[key] = value;
  }
  return values;
}

export function fieldErrorsOf(error: z.ZodError, formData?: FormData): FormState {
  return {
    values: formData ? formValues(formData, ["password", "confirm", "current"]) : undefined,
    fieldErrors: z.flattenError(error).fieldErrors as FormState["fieldErrors"],
  };
}
