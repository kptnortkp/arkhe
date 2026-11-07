// Isomorphic: the form, the pages, the actions and the push copy share these.
import type { IssueStatus } from "@/db/schema";

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  new: "Yeni",
  in_progress: "İnceleniyor",
  done: "Çözüldü",
  wontfix: "Yapılmayacak",
};

export const ISSUE_STATUS_STYLES: Record<IssueStatus, string> = {
  new: "bg-primary/10 text-primary",
  in_progress: "bg-late/18 text-late-ink",
  done: "bg-present/14 text-present-ink",
  wontfix: "bg-muted text-muted-foreground",
};

export const REPORT_TITLE_MIN = 3;
export const REPORT_TITLE_MAX = 120;
export const REPORT_BODY_MAX = 4000;
export const REPORT_REPLY_MAX = 2000;
export const REPORTS_PER_DAY = 10;
/** The client's downscale target: the long side, in pixels. */
export const REPORT_IMAGE_MAX_SIDE = 1600;
/** Screenshots may follow the report only this long after it was sent. */
export const REPORT_IMAGE_WINDOW_MS = 30 * 60_000;

export const REPORT_MSG = {
  titleShort: `Başlık en az ${REPORT_TITLE_MIN} karakter olmalı.`,
  titleLong: `Başlık en fazla ${REPORT_TITLE_MAX} karakter olabilir.`,
  bodyEmpty: "Ne olduğunu kısaca yaz.",
  bodyLong: `Açıklama en fazla ${REPORT_BODY_MAX} karakter olabilir.`,
  replyLong: `Yanıt en fazla ${REPORT_REPLY_MAX} karakter olabilir.`,
  rate: "Bugün çok fazla bildirim gönderdin. Yarın tekrar dene.",
  tooManyImages: "En fazla 3 ekran görüntüsü ekleyebilirsin.",
  notImage: "Bu dosya bir resim değil ya da türü desteklenmiyor (JPEG, PNG, WebP).",
  imageTooBig: "Ekran görüntüsü en fazla 2 MB olabilir.",
  imageClosed: "Bu bildirime artık ekran görüntüsü eklenemez.",
  imageFailed: "Ekran görüntüsü yüklenemedi.",
  notFound: "Bildirim bulunamadı.",
  saved: "Kaydedildi.",
  unchanged: "Değişiklik yok.",
} as const;

export function sentMessage(number: number) {
  return `Teşekkürler, bildirimin iletildi (Sorun #${number}).`;
}
