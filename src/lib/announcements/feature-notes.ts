import type { AnnouncementAudience, VoicePart } from "@/db/schema";

export type FeatureNote = {
  /** Stable and unique: it decides the announcement id, so a note goes out once ever. */
  key: string;
  /** Istanbul day the feature shipped; notes older than FEATURE_NOTE_MAX_AGE_DAYS are skipped. */
  date: string;
  audience: AnnouncementAudience;
  parts?: VoicePart[];
  /** 3–80 characters; the push shows the first 40. */
  title: string;
  /** Up to 1000 characters, plain text like any announcement. */
  body: string;
};

export const FEATURE_NOTE_MAX_AGE_DAYS = 14;

/**
 * "What's new" for the people a feature is for. Add an entry with the feature's commit: after
 * that deploy goes live it is published once as an announcement from the IT user.
 */
export const FEATURE_NOTES: FeatureNote[] = [
  {
    key: "gelecek-calismalar",
    date: "2026-11-10",
    audience: "board",
    title: "Yeni: Gelecek çalışmalarda kim yok?",
    body: `İleri tarihli çalışmalara kimlerin gelemeyeceğini artık tek ekranda görebilirsiniz.

Çalışmalar → Yaklaşan: gelemeyecek kişi olan her çalışmanın yanında "3 kişi yok" gibi bir etiket var.

Listenin en üstündeki "Gelecek çalışmalar"a dokunun (ya da Raporlar → Gelecek çalışmalar): her çalışma için kimlerin gelemeyeceği, mazeret açıklamaları ve partisyon bazında eksikler görünür (ör. T −1 (5/6): 6 tenordan 5'i gelecek).

Geçmiş çalışmalarda mazeretli olanlar artık "Gelmedi · mazeretli" olarak gösteriliyor; devam yüzdesinde zaten gelmedi sayılıyordu, yalnızca görünüm netleşti.

Bu ekranları yalnızca şef ve YK görür.`,
  },
];
