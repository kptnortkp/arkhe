import type {
  AttendanceStatus,
  CheckInMethod,
  LinkKind,
  PieceStatus,
  RehearsalType,
  Role,
  VoicePart,
} from "@/db/schema";
import type { Account, Category, DuesRate, EntryKind } from "@/lib/finance/categories";

export const ROLE_LABELS: Record<Role, string> = {
  conductor: "Koro şefi",
  board: "Yönetim kurulu",
  member: "Korist",
};

export const VOICE_PART_LABELS: Record<VoicePart, string> = {
  soprano: "Soprano",
  alto: "Alto",
  tenor: "Tenor",
  bass: "Bas",
};

// Static class names so Tailwind can see them.
export const VOICE_PART_STYLES: Record<VoicePart, { dot: string; soft: string; text: string }> = {
  soprano: { dot: "bg-soprano", soft: "bg-soprano/12", text: "text-soprano-ink" },
  alto: { dot: "bg-alto", soft: "bg-alto/14", text: "text-alto-ink" },
  tenor: { dot: "bg-tenor", soft: "bg-tenor/12", text: "text-tenor-ink" },
  bass: { dot: "bg-bass", soft: "bg-bass/12", text: "text-bass-ink" },
};

export const VOICE_PART_SHORT: Record<VoicePart, string> = {
  soprano: "S",
  alto: "A",
  tenor: "T",
  bass: "B",
};

export const REHEARSAL_TYPE_LABELS: Record<RehearsalType, string> = {
  tutti: "Tutti",
  sectional: "Partisyon",
  dress: "Genel prova",
  concert: "Konser",
};

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Geldi",
  late: "Geç geldi",
  excused: "Mazeretli",
  absent: "Gelmedi",
};

export const STATUS_SHORT: Record<AttendanceStatus, string> = {
  present: "Geldi",
  late: "Geç",
  excused: "Mazeretli",
  absent: "Gelmedi",
};

export const STATUS_STYLES: Record<
  AttendanceStatus,
  { dot: string; soft: string; text: string; solid: string }
> = {
  present: {
    dot: "bg-present",
    soft: "bg-present/14",
    text: "text-present-ink",
    solid: "bg-present text-present-foreground",
  },
  late: {
    dot: "bg-late",
    soft: "bg-late/18",
    text: "text-late-ink",
    solid: "bg-late text-gold-foreground",
  },
  excused: {
    dot: "bg-excused",
    soft: "bg-excused/14",
    text: "text-excused-ink",
    solid: "bg-excused text-excused-foreground",
  },
  absent: {
    dot: "bg-absent",
    soft: "bg-absent/12",
    text: "text-absent-ink",
    solid: "bg-absent text-absent-foreground",
  },
};

export const METHOD_LABELS: Record<CheckInMethod, string> = {
  qr: "QR",
  code: "Kod",
  manual: "Elle",
  self: "Mazeret",
  auto: "Otomatik",
};

export const PIECE_STATUS_LABELS: Record<PieceStatus, string> = {
  learning: "Çalışılıyor",
  concert: "Hazır",
  archive: "Arşiv",
};

export const PIECE_STATUS_HINTS: Record<PieceStatus, string> = {
  learning: "Şu an öğreniyoruz",
  concert: "Konserde söyleyebiliriz",
  archive: "Söyledik, dosyalar duruyor",
};

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  score: "Nota",
  part: "Partisyon kaydı",
  recording: "Referans kayıt",
  video: "Video",
  other: "Diğer",
};

export const LINK_KIND_GROUPS: Record<LinkKind, string> = {
  score: "Nota",
  part: "Partisyon kayıtları",
  recording: "Referans kayıt",
  video: "Video",
  other: "Diğer",
};

export const CATEGORY_LABELS: Record<Category, string> = {
  dues: "Aidat",
  sponsorship: "Sponsorluk",
  tickets: "Bilet satışı",
  donation: "Bağış",
  grant: "Hibe / destek",
  other_income: "Diğer gelir",
  costume: "Kostüm",
  venue: "Salon / mekân",
  musician_fee: "Şef / korrepetitör ücreti",
  scores_royalties: "Nota ve telif",
  travel: "Ulaşım ve konaklama",
  festival_fee: "Festival katılım ücreti",
  organisation: "Organizasyon / tanıtım",
  catering: "İkram",
  refund: "İade",
  bank_fee: "Banka masrafı",
  other_expense: "Diğer gider",
};

export const ENTRY_KIND_LABELS: Record<EntryKind, string> = {
  income: "Gelir",
  expense: "Gider",
  transfer: "Virman",
  opening: "Açılış bakiyesi",
};

export const ACCOUNT_LABELS: Record<Account, string> = {
  cash: "Kasa",
  bank: "Banka",
};

export const DUES_RATE_LABELS: Record<DuesRate, string> = {
  standard: "Tam",
  reduced: "İndirimli",
  exempt: "Muaf",
};
