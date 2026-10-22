// Isomorphic Turkish copy for Phase 9 (po-decisions D63). Server answers and client pre-checks
// use the same strings, so a test can match either.

export const MSG = {
  forbidden: "Bu işlem için yetkin yok.",
  auth: "Giriş yapmalısın.",
  generic: "Bir şeyler ters gitti, tekrar dene.",
  homeworkNotFound: "Ödev bulunamadı.",

  // Recording upload
  locked: "Şef yorum yazdı; kaydını artık değiştiremezsin.",
  uploadLimit: "Bu ödeve en fazla 5 kez kayıt yükleyebilirsin.",
  uploadRate: "Çok sık yükleme yaptın. Biraz sonra tekrar dene.",
  emptyTake: "Kayıt boş görünüyor. Yeniden kaydet.",
  emptyFile: "Bu dosya boş. Başka bir kayıt seç.",
  wrongType:
    "Bu dosya bir ses kaydı değil ya da türü desteklenmiyor. Telefonunun ses kaydedicisinden bir kayıt seç (m4a, mp3, wav…).",
  tooBig:
    "Dosya en fazla 4 MB olabilir. Daha kısa bir kayıt seç ya da burada Kayda başla ile kaydet.",
  quota:
    "Kayıt alanı şu an dolu; yükleme geçici olarak kapalı. Kaydın kaybolmadı: Kaydı indir ile telefonuna kaydet, sonra şefe başka yolla gönder.",
  putFailed:
    "Kayıt şu an yüklenemedi. Kaydın kaybolmadı: tekrar dene ya da Kaydı indir ile telefonuna kaydet.",
  disabled: "Kayıt yükleme henüz açılmadı.",
  conflict: "Kayıt bu arada değişti. Sayfayı yenileyip tekrar dene.",
  sent: "Kaydın gönderildi.",
  replaced: "Kaydın değiştirildi.",
  withdrawn: "Kaydın silindi.",

  // Playback
  playbackFailed: "Kayıt şu an açılamıyor. Biraz sonra tekrar dene.",
  playbackQuota: "Dinleme bu ay için geçici olarak kapalı (ücretsiz kota).",
  listenRate: "Çok sık dinleme isteği. Biraz sonra tekrar dene.",
  listenFileRate: "Bu kaydı son bir saatte çok sık açtın. Biraz sonra tekrar dene.",
  listenDaily: "Son 24 saatteki dinleme sınırına ulaştın. Birkaç saat sonra tekrar dene.",
  midiDaily: "Son 24 saatteki MIDI sınırına ulaştın. Birkaç saat sonra tekrar dene.",

  // Review
  recordingNotFound: "Kayıt bulunamadı.",
  staleForNote: "Kayıt bu arada değişti. Yeni kaydı dinleyip notunu kaydet.",
  staleForComment: "Korist bu arada kaydını değiştirdi. Yeni kaydı dinleyip yorumunu gönder.",
  noteEmpty: "Notunu yaz.",
  noteTooLong: "Not en fazla 1000 karakter olabilir.",
  noteLocked: "Şef yorumunu gönderdi; artık not eklenemez.",
  noteSaved: "Notun kaydedildi.",
  noteDeleted: "Notun silindi.",
  feedbackConductorOnly: "Geri bildirimi yalnızca şef yazar.",
  commentTooLong: "Yorum en fazla 1000 karakter olabilir.",
  commentSent: "Yorum gönderildi.",
  commentUpdated: "Yorum güncellendi.",
  commentDeleted: "Yorum silindi.",
  unmarkRefused: "Bu kişinin portalda kaydı var; teslimi kaldırmak için kaydı sil.",
  audioDeletedByConductor: "Ses dosyası silindi.",

  // Assistants
  assistantNotAllowed: "Bu kişi asistan olamaz.",
  assistantExists: "Bu kişi zaten asistan.",
  assistantNotFound: "Asistan bulunamadı.",
  pickPart: "En az bir partisyon seç.",
  assistantAdded: "Asistan eklendi.",
  assistantUpdated: "Asistan güncellendi.",
  assistantRemoved: "Asistan kaldırıldı.",

  // MIDI
  fileNotFound: "Dosya bulunamadı.",
  notMidi: "Bu bir MIDI dosyası değil (.mid).",
  midiTooBig: "MIDI dosyası en fazla 1 MB olabilir.",
  midiTooMany: "Bir esere en fazla 20 MIDI dosyası eklenebilir.",
  midiLabelTooLong: "Etiket en fazla 60 karakter olabilir.",
  midiFull: "Dosya alanı dolu; yeni dosya yüklenemiyor.",
  midiUnplayable: "Bu MIDI dosyası çalınamıyor.",
  midiUploaded: "Dosya yüklendi.",
  midiDeleted: "Dosya silindi.",
  pieceNotFound: "Eser bulunamadı.",

  // Storage page
  storageNotConfigured: "Dosya deposu bağlı değil.",
} as const;

/** "<n> kayıt silindi." after the conductor's early clean. */
export function earlyCleanDone(n: number) {
  return `${n} kayıt silindi.`;
}
