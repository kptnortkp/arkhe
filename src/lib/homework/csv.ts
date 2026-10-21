import { csvDocument } from "@/lib/csv";
import { HOMEWORK_STATE_LABELS, VOICE_PART_LABELS } from "@/lib/labels";
import { formatAuditDateTime } from "@/lib/time";
import type { VoicePart } from "@/db/schema";
import { barsLabel } from "./mail";

export const HOMEWORK_HEADER = [
  "Ödev",
  "Eser",
  "Son tarih",
  "Ad soyad",
  "Partisyon",
  "Durum",
  "Teslim tarihi",
];

type HomeworkCsvRow = {
  pieceTitle: string;
  barFrom: number | null;
  barTo: number | null;
  dueAt: Date;
  name: string;
  part: VoicePart | null;
  state: keyof typeof HOMEWORK_STATE_LABELS;
  submittedAt: Date | null;
};

/** Rows must already be sorted by due date, then name. */
export function homeworkCsv(rows: HomeworkCsvRow[]) {
  return csvDocument(
    HOMEWORK_HEADER,
    rows.map((r) => [
      barsLabel(r.barFrom, r.barTo),
      r.pieceTitle,
      formatAuditDateTime(r.dueAt),
      r.name,
      r.part ? VOICE_PART_LABELS[r.part] : "",
      HOMEWORK_STATE_LABELS[r.state],
      r.submittedAt ? formatAuditDateTime(r.submittedAt) : "",
    ]),
  );
}
