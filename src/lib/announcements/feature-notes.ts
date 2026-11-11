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
  {
    key: "takvim-hazirlik-konser",
    date: "2026-11-11",
    audience: "all",
    title: "Yeni: Takvim, eser hazırlığı ve konser",
    body: `Portala üç yenilik geldi:

Takvim aboneliği: Profil → Takvim aboneliği → "iPhone / Mac takvimine ekle" ya da "Google Takvim'e ekle". Çalışmalar telefonunun takvimine düşer; saat, yer ya da iptal değişince orada da güncellenir.

Eser hazırlığı: Her eserin sayfasında "Bu eserde ne durumdasın?" sorusu var. Hazır değilim · Kısmen · Hazırım seç; şef partisyonların durumunu görüp çalışmaları buna göre planlar. İstediğin zaman değiştirebilirsin.

Konser: Konserlerde "Söyleyeceğim" ya da "Söyleyemeyeceğim" diye cevap ver; şef kadroyu buna göre kurar. Cevap bekleyen konser ana sayfanda görünür.

Ayrıca şef ve asistanların yazdığı çalışma notları ("bu hafta neye çalışalım") artık ana sayfanda ve eser sayfasında.`,
  },
  {
    key: "hazirlik-notlar-kadro-yk",
    date: "2026-11-11",
    audience: "board",
    title: "Yeni: Hazırlık raporu, notlar, konser kadrosu",
    body: `Şef ve YK için:

Raporlar → Eser hazırlığı: koristlerin her eserde kendi işaretlediği durum, partisyon bazında (hazır / kısmen / hazır değil / cevap yok). Eser sayfasında da aynı özet var; isimler partisyona dokununca açılır.

Çalışma notları: Bir çalışmanın sayfasında "Not ekle" ile neye çalışılacağını yazın; eser ve partisyon seçilebilir, istenirse ilgili koristlere bildirim gider. Dinleme asistanları da kendi partisyonlarına not yazabilir.

Konser kadrosu: Konser türündeki çalışmanın sayfasında kimin söyleyeceği, kimin söyleyemeyeceği (açıklamasıyla) ve kimin cevap vermediği partisyon bazında görünür.`,
  },
  {
    key: "ozel-gunler",
    date: "2026-11-11",
    audience: "all",
    title: "Yeni: Özel günler",
    body: `Çalışmalar sayfasında artık "Özel günler" var: resmi tatiller, arifeler ve koro için önemli günler, yıllık takvim olarak.

Renkler: kırmızımsı resmi tatil, sarı arife (13.00'ten sonra), mavi hafta sonu, gri anma günü. Çalışmalar sayfasında sıradaki özel gün de yazar.`,
  },
  {
    key: "festivaller-yk",
    date: "2026-11-11",
    audience: "board",
    title: "Yeni: Festivaller",
    body: `Şef ve YK için: Yönetim Kurulu → Festivaller.

Google tablosundaki festivaller portala aktarıldı; renkler aynı (sarı Türkiye, mavi yurt dışı, yeşil katılıyoruz, parlak yeşil yeni eklendi). Her festivalde tarih, son başvuru günü ve kaç gün kaldığı, ücret, yer ve bağlantı var; buradan ekleyip düzenleyebilirsiniz.

Festival günleri ve son başvuru günleri Yönetim takviminde ve kendi takvim aboneliğinizde görünür.

Bildirimler: Henüz başvurmadığımız bir festivalin son başvurusundan 14, 7, 3 ve 1 gün önce ve son gün bildirim gelir. Başvurunca durumu "Başvurduk" ya da "Katılıyoruz" yapın; hatırlatmalar durur, bunun yerine festivalden 30, 7 ve 1 gün önce "Festival yaklaşıyor" bildirimi gelir.

"Excel" düğmesi tablonun güncel halini eski düzende indirir: Festivaller ve Özel Günler sekmeleri, aynı renklerle.`,
  },
];
