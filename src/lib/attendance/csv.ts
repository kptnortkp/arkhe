import { csvDocument, type CsvValue } from "@/lib/csv";
import { VOICE_PART_LABELS } from "@/lib/labels";
import type { MemberStats } from "./stats";

export const ATTENDANCE_HEADER = [
  "Ad soyad",
  "Partisyon",
  "Geldi",
  "Beklenen",
  "Yüzde",
  "Geç",
  "Mazeretli",
  "Gelmedi",
  "Uyarı",
];

export function attendanceRows(rows: MemberStats[]): CsvValue[][] {
  return rows.map((m) => [
    m.name,
    m.voicePart ? VOICE_PART_LABELS[m.voicePart] : "",
    m.attended,
    m.expected,
    m.percent ?? "",
    m.late,
    m.excused,
    m.absent,
    m.warning ? "Evet" : "",
  ]);
}

export function attendanceCsv(rows: MemberStats[]) {
  return csvDocument(ATTENDANCE_HEADER, attendanceRows(rows));
}
