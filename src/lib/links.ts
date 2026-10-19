// Shared by forms, the bulk preview, server actions and the renderer; must stay free of Node APIs.
import type { LinkKind, VoicePart } from "@/db/schema";
import { searchKey } from "@/lib/format";
import { LINK_KIND_LABELS, VOICE_PART_LABELS } from "@/lib/labels";

export const LINK_MAX = 2000;
export const LABEL_MAX = 120;
export const BULK_MAX_LINES = 50;
export const INVALID_LINK = "Geçerli bir https bağlantısı gir.";
export const DUPLICATE_LINK = "Bu bağlantı bu eserde zaten var.";
export const DUPLICATE_IN_PASTE = "Bu bağlantı listede iki kez var.";

export type LinkProvider = "drive-file" | "drive-folder" | "docs" | "youtube" | "external";

export type ParsedLink = {
  /** Normalised value: what we store and what "Aç" opens. */
  url: string;
  provider: LinkProvider;
  /** Only ever built from fixed templates and charset-checked ids. */
  previewSrc: string | null;
  host: string;
};

const DRIVE_ID = /^[A-Za-z0-9_-]{3,200}$/;
const YT_ID = /^[A-Za-z0-9_-]{3,64}$/;
const SAFE_URL = /^https:\/\/[^\s<>"'`\\\u0000-\u001f\u007f]+$/i;
const YOUTUBE_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
]);

function youtubeStart(u: URL) {
  const raw = u.searchParams.get("t") ?? u.searchParams.get("start");
  if (!raw) return null;
  let sec: number | null = null;
  const plain = /^(\d+)s?$/.exec(raw);
  const hms = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw);
  if (plain) sec = Number(plain[1]);
  else if (hms && raw)
    sec = Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0);
  return sec && sec > 0 && sec <= 86_400 ? sec : null;
}

function youtube(id: string, start: number | null): ParsedLink {
  return {
    url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ""}`,
    provider: "youtube",
    previewSrc: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`,
    host: "www.youtube.com",
  };
}

function driveFile(id: string, rk: string | null): ParsedLink {
  const key = rk ? `?resourcekey=${rk}` : "";
  return {
    url: `https://drive.google.com/file/d/${id}/view${key}`,
    provider: "drive-file",
    previewSrc: `https://drive.google.com/file/d/${id}/preview${key}`,
    host: "drive.google.com",
  };
}

function driveFolder(id: string, rk: string | null): ParsedLink {
  return {
    url: `https://drive.google.com/drive/folders/${id}${rk ? `?resourcekey=${rk}` : ""}`,
    provider: "drive-folder",
    previewSrc: `https://drive.google.com/embeddedfolderview?id=${id}${rk ? `&resourcekey=${rk}` : ""}#list`,
    host: "drive.google.com",
  };
}

/** Returns null for anything that isn't a safe https URL. */
export function parseLink(raw: string): ParsedLink | null {
  const s = raw.trim();
  if (!s || s.length > LINK_MAX || !SAFE_URL.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname;
  const external: ParsedLink = { url: u.href, provider: "external", previewSrc: null, host };
  if (u.href.length > LINK_MAX) return null;

  const seg = u.pathname.split("/").filter(Boolean);
  // Drive puts the signed-in account index anywhere near the start: /u/0/, /drive/u/1/…
  const uAt = seg.slice(0, 3).findIndex((p, i) => p === "u" && /^\d+$/.test(seg[i + 1] ?? ""));
  if (uAt >= 0) seg.splice(uAt, 2);

  if (host === "drive.google.com") {
    const rkRaw = u.searchParams.get("resourcekey");
    const rk = rkRaw && DRIVE_ID.test(rkRaw) ? rkRaw : null;
    if (seg[0] === "file" && seg[1] === "d" && DRIVE_ID.test(seg[2] ?? "")) {
      return driveFile(seg[2], rk);
    }
    if ((seg[0] === "open" || seg[0] === "uc") && seg.length === 1) {
      const id = u.searchParams.get("id");
      if (id && DRIVE_ID.test(id)) return driveFile(id, rk);
    }
    const folderAt = seg[0] === "drive" ? (seg[1] === "mobile" ? 2 : 1) : -1;
    if (folderAt > 0 && seg[folderAt] === "folders" && DRIVE_ID.test(seg[folderAt + 1] ?? "")) {
      return driveFolder(seg[folderAt + 1], rk);
    }
    return external;
  }
  if (host === "docs.google.com") {
    const docKinds = ["document", "spreadsheets", "presentation", "forms"];
    if (docKinds.includes(seg[0]) && seg[1] === "d" && DRIVE_ID.test(seg[2] ?? "")) {
      return { ...external, provider: "docs" };
    }
    return external;
  }
  if (host === "youtu.be") {
    return seg.length === 1 && YT_ID.test(seg[0]) ? youtube(seg[0], youtubeStart(u)) : external;
  }
  if (YOUTUBE_HOSTS.has(host)) {
    const v = u.searchParams.get("v");
    if (seg.length === 1 && seg[0] === "watch" && v && YT_ID.test(v)) {
      return youtube(v, youtubeStart(u));
    }
    if (["shorts", "live", "embed"].includes(seg[0]) && seg.length === 2 && YT_ID.test(seg[1])) {
      return youtube(seg[1], youtubeStart(u));
    }
  }
  return external;
}

export function hostLabel(parsed: ParsedLink) {
  switch (parsed.provider) {
    case "drive-file":
    case "drive-folder":
      return "Drive";
    case "docs":
      return "Docs";
    case "youtube":
      return "YouTube";
    default:
      return parsed.host;
  }
}

export function deriveLabel(kind: LinkKind, voicePart: VoicePart | null) {
  return `${LINK_KIND_LABELS[kind]} · ${voicePart ? VOICE_PART_LABELS[voicePart] : "Tutti"}`;
}

export function linkLabel(link: {
  kind: LinkKind;
  voicePart: VoicePart | null;
  label: string | null;
}) {
  return link.label ?? deriveLabel(link.kind, link.voicePart);
}

type PartLink = { voicePart: VoicePart | null; position: number; id?: string };

/** The part files behind "Partisyonum": my part, else Tutti. Null when the user has no part. */
export function resolveMyPart<T extends PartLink>(partLinks: T[], myPart: VoicePart | null) {
  if (!myPart) return null;
  const sorted = [...partLinks].sort(
    (a, b) => a.position - b.position || (a.id ?? "").localeCompare(b.id ?? ""),
  );
  const mine = sorted.filter((l) => l.voicePart === myPart);
  const pool = mine.length ? mine : sorted.filter((l) => l.voicePart === null);
  return { links: pool, tutti: mine.length === 0 && pool.length > 0 };
}

// Bulk paste ---------------------------------------------------------------------------------

/** `folder` = becomes the piece's Drive folder instead of a link. */
export type BulkKind = LinkKind | "folder";

export type BulkRow = {
  line: string;
  label: string | null;
  kind: BulkKind;
  voicePart: VoicePart | null;
  url: string;
  error: string | null;
};

const PART_PATTERNS: [VoicePart | null, RegExp][] = [
  ["soprano", /^(sop|sopran|soprano)[12]?$|^s[12]$/],
  ["alto", /^alto[12]?$|^a[12]$/],
  ["tenor", /^tenor[12]?$|^t[12]$/],
  ["bass", /^(bas|bass|basso)[12]?$|^b[12]$/],
  [null, /^(tutti|hepsi|tumu)$/],
];

function tokensOf(label: string) {
  return searchKey(label)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function guessPart(tokens: string[]): VoicePart | null | undefined {
  const found = new Set<VoicePart | null>();
  for (const t of tokens) {
    for (const [part, re] of PART_PATTERNS) if (re.test(t)) found.add(part);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

export function guessLink(
  label: string | null,
  parsed: ParsedLink,
  folderFree: boolean,
): { kind: BulkKind; voicePart: VoicePart | null } {
  const tokens = label ? tokensOf(label) : [];
  const has = (...words: string[]) => tokens.some((t) => words.includes(t));
  const part = guessPart(tokens);
  const voicePart = part ?? null;
  let kind: BulkKind;
  if (parsed.provider === "youtube") kind = "video";
  else if (has("midi", "mid", "mp3", "wav", "m4a", "partisyon")) kind = "part";
  else if (has("nota", "score", "pdf", "partitur")) kind = "score";
  else if (has("kayit", "recording", "referans")) kind = "recording";
  else if (has("video")) kind = "video";
  else if (parsed.provider === "drive-folder") kind = folderFree ? "folder" : "other";
  else if (part !== undefined && part !== null) kind = "part";
  else if (parsed.provider === "drive-file") kind = "score";
  else kind = "other";
  return { kind, voicePart: kind === "folder" ? null : voicePart };
}

function splitLine(line: string): { url: ParsedLink; label: string | null } | null {
  const tokens = line.split(/\s+/);
  const last = parseLink(tokens[tokens.length - 1]);
  if (last) {
    const label = tokens
      .slice(0, -1)
      .join(" ")
      .replace(/[\s|:\-–]+$/, "")
      .trim();
    return { url: last, label: label.slice(0, LABEL_MAX) || null };
  }
  const first = parseLink(tokens[0]);
  if (first) {
    const label = tokens
      .slice(1)
      .join(" ")
      .replace(/^[\s|:\-–]+/, "")
      .trim();
    return { url: first, label: label.slice(0, LABEL_MAX) || null };
  }
  return null;
}

/** Parses pasted lines; `error` is a form-level message (too many lines, nothing pasted). */
export function parseBulk(
  text: string,
  ctx: { existing: Iterable<string>; folderFree: boolean },
): { rows: BulkRow[]; error?: string } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], error: "Yapıştırılacak bağlantı yok." };
  if (lines.length > BULK_MAX_LINES) {
    return { rows: [], error: `En fazla ${BULK_MAX_LINES} satır yapıştırabilirsin.` };
  }
  const existing = new Set(ctx.existing);
  const seen = new Set<string>();
  let folderFree = ctx.folderFree;
  const rows = lines.map((line): BulkRow => {
    const split = splitLine(line);
    if (!split) {
      return { line, label: null, kind: "other", voicePart: null, url: "", error: INVALID_LINK };
    }
    const { kind, voicePart } = guessLink(split.label, split.url, folderFree);
    if (kind === "folder") folderFree = false;
    const url = split.url.url;
    const error = existing.has(url) ? DUPLICATE_LINK : seen.has(url) ? DUPLICATE_IN_PASTE : null;
    seen.add(url);
    return { line, label: split.label, kind, voicePart, url, error };
  });
  return { rows };
}
