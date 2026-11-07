// Isomorphic: the compose form, the server actions and the pages share these.
import type { AnnouncementAudience } from "@/db/schema";

export const ANNOUNCEMENT_TITLE_MIN = 3;
export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 1000;
export const ANNOUNCEMENTS_PER_DAY = 20;
export const SHOW_DAYS_DEFAULT = 7;
export const SHOW_DAYS_MAX = 60;
export const HOME_MAX = 3;
export const PUSH_TITLE_MAX = 40;
export const PUSH_BODY_MAX = 120;

export const AUDIENCE_LABELS: Record<AnnouncementAudience, string> = {
  all: "Herkes",
  parts: "Partisyonlar",
  board: "Sadece YK",
};

export const ANNOUNCEMENT_MSG = {
  titleShort: `Başlık en az ${ANNOUNCEMENT_TITLE_MIN} karakter olmalı.`,
  titleLong: `Başlık en fazla ${ANNOUNCEMENT_TITLE_MAX} karakter olabilir.`,
  bodyEmpty: "Duyuru metnini yaz.",
  bodyLong: `Duyuru metni en fazla ${ANNOUNCEMENT_BODY_MAX} karakter olabilir.`,
  parts: "En az bir partisyon seç.",
  showUntil: `Bugünden en fazla ${SHOW_DAYS_MAX} gün sonrasına kadar bir tarih seç.`,
  rate: "Bugün çok fazla duyuru gönderdin. Yarın tekrar dene.",
  forbidden: "Bu işlem için yetkin yok.",
  notFound: "Bu duyuru artık yok.",
  sent: "Duyuru gönderildi.",
  saved: "Duyuru kaydedildi.",
  resent: "Duyuru kaydedildi ve tekrar bildirildi.",
  resendBlocked: "Duyuru kaydedildi; bugün çok fazla duyuru gönderdiğin için tekrar bildirilmedi.",
  deleted: "Duyuru silindi.",
} as const;

/** Cuts to `max` characters (code points), ending with "…" when cut. */
export function cutText(s: string, max: number) {
  const chars = [...s.replace(/\s+/g, " ").trim()];
  return chars.length <= max
    ? chars.join("")
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

/** What the phone shows: the title (≤40) and the start of the text (≤120). */
export function pushPreview(title: string, body: string) {
  return { title: cutText(title, PUSH_TITLE_MAX), body: cutText(body, PUSH_BODY_MAX) };
}
