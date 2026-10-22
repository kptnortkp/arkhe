import "server-only";
import { cookies } from "next/headers";
import { secureCookies } from "@/lib/auth/cookie-names";

export const FLASH_COOKIE = "arkhe_flash";

// The cookie carries only a key (plus a validated number); any other value is ignored, so no
// text can be injected.
const FLASH_MESSAGES = {
  "kayit-duzeltildi": "Kayıt düzeltildi.",
  kaydedildi: "Kaydedildi.",
  "taslak-olusturuldu": "Taslak oluşturuldu. Şimdi tutarları yaz.",
  "plan-kaydedildi": "Plan kaydedildi.",
  "butce-silindi": "Bütçe silindi.",
} as const;

const NUMBERED_MESSAGES = {
  "is-acildi": (n: number) => `#${n} açıldı.`,
  "is-silindi": (n: number) => `#${n} silindi.`,
} as const;

export type FlashKey = keyof typeof FLASH_MESSAGES;
export type NumberedFlashKey = keyof typeof NUMBERED_MESSAGES;

const NUMBERED = /^(is-acildi|is-silindi):([1-9]\d{0,8})$/;

/** A toast for the next page, for actions that redirect and so can't return one. */
export async function setFlash(key: FlashKey): Promise<void>;
export async function setFlash(key: NumberedFlashKey, n: number): Promise<void>;
export async function setFlash(key: FlashKey | NumberedFlashKey, n?: number) {
  const value = n === undefined ? key : `${key}:${n}`;
  (await cookies()).set(FLASH_COOKIE, value, {
    sameSite: "lax",
    path: "/",
    maxAge: 30,
    secure: secureCookies,
  });
}

export async function readFlash() {
  const raw = (await cookies()).get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  if (Object.hasOwn(FLASH_MESSAGES, raw)) return FLASH_MESSAGES[raw as FlashKey];
  const m = NUMBERED.exec(raw);
  return m ? NUMBERED_MESSAGES[m[1] as NumberedFlashKey](Number(m[2])) : null;
}
