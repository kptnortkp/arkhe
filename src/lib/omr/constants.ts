// Isomorphic: the schema, the server, the editor and e2e share these. No Node APIs.

export const OMR_LAYOUTS = ["satb", "kadin_erkek", "sa_tb", "auto"] as const;
export type OmrLayout = (typeof OMR_LAYOUTS)[number];

export const OMR_JOB_STATES = ["queued", "running", "succeeded", "failed"] as const;
export type OmrJobState = (typeof OMR_JOB_STATES)[number];

/** D102: the workflow may only send the first five; the rest are the portal's own. */
export const OMR_WORKFLOW_KINDS = [
  "pdf_unreadable",
  "too_many_pages",
  "no_music",
  "layout_mismatch",
  "output_invalid",
] as const;
export const OMR_ERROR_KINDS = [
  ...OMR_WORKFLOW_KINDS,
  "not_started",
  "timeout",
  "dispatch_auth",
  "dispatch_failed",
  "storage_full",
  "unknown",
] as const;
export type OmrErrorKind = (typeof OMR_ERROR_KINDS)[number];

export const OMR_TEMPO_MIN = 40;
export const OMR_TEMPO_MAX = 220;
/** D100: read-time limits. */
export const OMR_QUEUED_MAX_MS = 20 * 60_000;
export const OMR_TOTAL_MAX_MS = 45 * 60_000;
/** D101. */
export const OMR_PER_MANAGER_DAY = 10;
export const OMR_PER_CHOIR_30_DAYS = 40;
/** AC 4. */
export const OMR_RESULT_MAX_BYTES = 2 * 1024 * 1024;
export const OMR_MAX_TRACKS = 16;
export const OMR_TRACK_NAME_MAX = 40;
export const OMR_MEASURES_MAX = 2000;
/** D98: accepted clock skew of a signed request. */
export const OMR_SKEW_SECONDS = 300;
export const OMR_POLL_MS = 10_000;

export const OMR_LAYOUT_LABELS: Record<OmrLayout, string> = {
  satb: "Soprano, Alto, Tenor, Bas ayrı satırlarda",
  kadin_erkek: "Kadın ve Erkek (iki satır)",
  sa_tb: "SA ve TB (iki satır, her satırda iki ses)",
  auto: "Bilmiyorum (otomatik)",
};

/** §3 failure sentences; the workflow's free text is never shown (D102). */
export function omrFailureText(kind: string | null, expected: number | null, found: number | null) {
  switch (kind) {
    case "pdf_unreadable":
      return "PDF okunamadı. Taranmış bir notaysa daha net bir tarama dene.";
    case "too_many_pages":
      return "PDF en fazla 20 sayfa olabilir.";
    case "no_music":
      return "Notada portek bulunamadı.";
    case "layout_mismatch":
      return expected !== null && found !== null
        ? `Seçilen düzene uymadı: ${expected} ses satırı bekleniyordu, ${found} bulundu. Düzeni değiştirip yeniden dene.`
        : "Çeviri başarısız oldu. Yeniden dene.";
    case "output_invalid":
      return "Çeviri sonucu kullanılamadı. Yeniden dene; olmazsa MIDI'yi elle yükle.";
    case "not_started":
      return "GitHub işi başlamadı. Biraz sonra yeniden dene.";
    case "timeout":
      return "Çeviri 45 dakikada bitmedi. Yeniden dene.";
    case "dispatch_auth":
      return "GitHub bağlantısı reddedildi; erişim anahtarının süresi dolmuş olabilir. Portalı kuran kişiye haber ver.";
    case "storage_full":
      return "Dosya alanı dolu olduğu için sonuç kaydedilemedi. Yer açılınca yeniden dene.";
    case "dispatch_failed":
      return "GitHub'a ulaşılamadı. Biraz sonra yeniden dene.";
    default:
      return "Çeviri başarısız oldu. Yeniden dene.";
  }
}

export const OMR_MSG = {
  notPdf: "Bu dosya PDF değil.",
  pdfTooBig: "PDF en fazla 4 MB olabilir.",
  scoreLocked: "Çeviri sürerken nota değiştirilemez.",
  scoreUploaded: "Nota yüklendi.",
  scoreDeleted: "Nota silindi.",
  scoreMissing: "Önce notanın PDF'ini yükle.",
  pickPdf: "Bir PDF seç.",
  layoutRequired: "Satır düzenini seç.",
  tempoRange: "Tempo 40 ile 220 arasında olmalı.",
  active: "Bu eserde zaten bir çeviri sürüyor.",
  managerDay: "Bugün en fazla 10 çeviri başlatabilirsin.",
  choirMonth: "Bu ay için otomatik çeviri sınırı doldu (40). Elle MIDI yükleyebilirsin.",
  notConfigured:
    "Otomatik çeviri kurulmadı. Nota yükleyebilir ve MIDI'yi elle ekleyebilirsin.",
  started: "Çeviri başladı.",
  published: "Yayınlandı; koristler artık görüyor.",
  draftDeleted: "Taslak silindi.",
} as const;
