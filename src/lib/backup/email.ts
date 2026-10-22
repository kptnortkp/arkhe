// Every word of the backup emails lives here (ux.md §10). Plural address; one paragraph per line.
import { budgetEmailLine, type BudgetStatus } from "@/lib/finance/budget";
import { formatKurus, formatNet } from "@/lib/money";
import { formatAuditDateTime } from "@/lib/time";
import { README_SECTION } from "./constants";
import { monthLabel } from "./schedule";

export type MonthSummary = {
  rehearsals: number;
  attendancePercent: number | null;
  assignments: number;
  onTimePercent: number | null;
  income: number;
  expense: number;
  net: number;
};

export type AttachmentNames = {
  attendance: string;
  homework: string;
  ledger: string;
  dues: string;
  backup: string;
};

const pct = (v: number | null) => (v === null ? "—" : `%${v}`);

export function attachmentNames(month: string, sentAtIstanbul: { date: string; time: string }) {
  return {
    attendance: `arkhe-devam-${month}.csv`,
    homework: `arkhe-odev-${month}.csv`,
    ledger: `arkhe-finans-${month}.csv`,
    dues: `arkhe-aidat-${month}.csv`,
    backup: `arkhe-yedek-${sentAtIstanbul.date}-${sentAtIstanbul.time.replace(":", "")}.sql.gz.enc`,
  } satisfies AttachmentNames;
}

/** The optional sixth attachment: the budget covering the report month (Phase 8, D39). */
export function budgetAttachmentName(month: string) {
  return `arkhe-butce-${month}.csv`;
}

export type BudgetMailLine = {
  name: string;
  status: BudgetStatus;
  incomePct: number | null;
  expensePct: number | null;
  filename: string;
};

export function monthlyEmail(input: {
  month: string;
  manual: { name: string; at: Date } | null;
  summary: MonthSummary;
  files: AttachmentNames;
  pageUrl: string;
  // Absent: the body is byte-identical to Phase 7.
  budget?: BudgetMailLine | null;
}) {
  const b = input.budget;
  const label = monthLabel(input.month);
  const s = input.summary;
  const subject = `Arkhe aylık rapor ve yedek · ${label}${input.manual ? " (elle gönderildi)" : ""}`;
  const lines = [
    "Merhaba,",
    "",
    ...(input.manual
      ? [
          `Bu e-postayı ${input.manual.name} portaldan elle gönderdi (${formatAuditDateTime(input.manual.at)}).`,
          "",
        ]
      : []),
    `Arkhe Portal'ın ${label} raporları ve koronun tüm kayıtlarının şifreli yedeği ekte.`,
    "",
    `Çalışma: ${s.rehearsals} · Ortalama devam: ${pct(s.attendancePercent)}`,
    `Ödev: ${s.assignments} · Zamanında teslim: ${pct(s.onTimePercent)}`,
    `Gelir: ${formatKurus(s.income)} · Gider: ${formatKurus(s.expense)} · Net: ${formatNet(s.net)}`,
    ...(b ? [budgetEmailLine(b)] : []),
    "",
    "Ekler:",
    `- ${input.files.attendance}: kişi bazında devam`,
    `- ${input.files.homework}: ödev teslimleri`,
    `- ${input.files.ledger}: kasa hareketleri`,
    `- ${input.files.dues}: aidat durumu (gönderim günü itibarıyla)`,
    ...(b ? [`- ${b.filename}: bütçe planı ve gerçekleşen`] : []),
    `- ${input.files.backup}: şifreli yedek`,
    "",
    "CSV dosyaları telefonda ya da Excel'de açılır.",
    "",
    `Yedek dosyasını açmanız gerekmez; bu e-postayı silmeden saklayın. Portalda bir sorun olursa koronun kayıtları bu dosyadan geri getirilir. Dosya şifrelidir ve şifresi bu e-postada yoktur. Gerekirse dosyayı portalı kuran kişi açar; adımlar README'nin "${README_SECTION}" bölümünde.`,
    "",
    "Ses kayıtları ve MIDI dosyaları bu yedeğe dahil değildir; kayıtlar 90 gün sonra zaten silinir.",
    "",
    "Raporlar şifresizdir; bu e-postayı koro yönetimi dışında kimseye iletmeyin.",
    "",
    "Bu e-posta her ayın 1'inde kendiliğinden gönderilir. Alıcıları koro şefi buradan değiştirir:",
    input.pageUrl,
  ];
  return { subject, text: lines.join("\n") + "\n" };
}

export function changeNoticeEmail(input: {
  actorName: string;
  at: Date;
  recipients: string[];
  pageUrl: string;
}) {
  const lines = [
    "Merhaba,",
    "",
    "Arkhe Portal'ın aylık rapor ve yedek e-postasının alıcı listesi değişti.",
    "",
    `Değiştiren: ${input.actorName} · ${formatAuditDateTime(input.at)}`,
    "",
    "Güncel alıcı listesi:",
    ...input.recipients.map((r) => `- ${r}`),
    "",
    "Listeden çıkarıldıysanız aylık e-posta artık size gelmeyecek.",
    "",
    "Bu değişiklikten haberiniz yoksa koro şefine hemen haber verin.",
    "",
    "Listeyi buradan görebilirsiniz:",
    input.pageUrl,
  ];
  return { subject: "Arkhe yedek alıcıları değişti", text: lines.join("\n") + "\n" };
}
