export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase("tr");
}

export function firstName(name: string) {
  return name.split(/\s+/)[0] ?? name;
}

export const dateTimeFormat = new Intl.DateTimeFormat("tr-TR", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Istanbul",
});

export const collator = new Intl.Collator("tr", { sensitivity: "base" });

/** Case- and diacritic-insensitive key for Turkish search ("IREM" finds "İrem", "sule" finds "Şule"). */
export function searchKey(text: string) {
  return text
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

/** Seconds as "m:ss". */
export function formatDuration(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** "3:40", "3.40" or "3,40" to seconds; null when it isn't m:ss between 0:01 and 99:59. */
export function parseDuration(text: string) {
  const m = /^(\d{1,2})[:.,]([0-5]\d)$/.exec(text.trim());
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec > 0 ? sec : null;
}

const megabytes = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** "184 KB" below 1 MB (at least 1 KB), else "1,2 MB". */
export function formatBytes(bytes: number) {
  const mb = 1024 * 1024;
  const kb = Math.max(1, Math.round(bytes / 1024));
  if (kb < 1024) return `${kb} KB`;
  return `${megabytes.format(bytes / mb)} MB`;
}
