// Pure iCalendar (RFC 5545) writer for the rehearsal feed.

export type FeedEvent = {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  cancelled: boolean;
};

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
function fold(line: string) {
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (size + bytes > limit) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildCalendar(
  events: FeedEvent[],
  { name, url, stamp: at }: { name: string; url: string; stamp: Date },
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Koro Arkhe//Portal//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
    "X-WR-TIMEZONE:Europe/Istanbul",
    "REFRESH-INTERVAL;VALUE=DURATION:PT4H",
    "X-PUBLISHED-TTL:PT4H",
  ];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@koroarkhe`,
      `DTSTAMP:${stamp(at)}`,
      `DTSTART:${stamp(e.startsAt)}`,
      `DTEND:${stamp(e.endsAt)}`,
      `SUMMARY:${escapeText(e.cancelled ? `İPTAL: ${e.title}` : e.title)}`,
      `STATUS:${e.cancelled ? "CANCELLED" : "CONFIRMED"}`,
      `URL:${url}/calismalar/${e.id}`,
    );
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    const description = [e.description, `${url}/calismalar/${e.id}`].filter(Boolean).join("\n\n");
    lines.push(`DESCRIPTION:${escapeText(description)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
