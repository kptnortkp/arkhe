import { csvDocument } from "@/lib/csv";
import { VOICE_PART_LABELS } from "@/lib/labels";
import type { MemberStats } from "./stats";

export function attendanceCsv(rows: MemberStats[]) {
  const header = [
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
  return csvDocument(
    header,
    rows.map((m) => [
      m.name,
      m.voicePart ? VOICE_PART_LABELS[m.voicePart] : "",
      m.attended,
      m.expected,
      m.percent ?? "",
      m.late,
      m.excused,
      m.absent,
      m.warning ? "Evet" : "",
    ]),
  );
}
