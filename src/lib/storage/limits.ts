// Isomorphic: the schema, the server and the client pre-checks share these. No Node APIs.

export const RECORDING_TYPES = [
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
] as const;
export type RecordingType = (typeof RECORDING_TYPES)[number];
// Detected type -> extension of the storage key; recordings_storage_key_check mirrors this map.
export const RECORDING_EXTENSIONS = {
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
} as const satisfies Record<RecordingType, string>;

export const RECORDING_MAX_BYTES = 4_194_304;
export const MIDI_MAX_BYTES = 1_048_576;
/** Uploads per (homework, singer), withdrawn and deleted takes included (D7, D42). */
export const MAX_UPLOADS_PER_SLOT = 5;
export const MIDI_MAX_PER_PIECE = 20;
export const MIDI_LABEL_MAX = 60;
export const NOTE_MAX = 1000;
/** The recorder's hard stop; the server clamps reported durations to it (D35). */
export const MAX_DURATION_MS = 600_000;

// Quota, decimal and pessimistic (D19, D37).
export const STORAGE_LIMIT_BYTES = 1_000_000_000;
export const UPLOAD_LIMIT = 2_000;
export const TRANSFER_LIMIT_BYTES = 10_000_000_000;
export const READ_LIMIT = 10_000;
export const QUOTA_WINDOW_MS = 30 * 24 * 3_600_000;
export const WARN_RATIO = 0.8;
export const UPLOAD_STOP_RATIO = 0.95;
export const PLAYBACK_STOP_RATIO = 1;

// Retention in Istanbul days (D17, D54).
export const COMMENTED_KEEP_DAYS = 90;
export const UNCOMMENTED_KEEP_DAYS = 120;
export const EARLY_CLEAN_DAYS = 30;
/**
 * Per-viewer delivery caps (rolling windows), so one member can't burn the choir's monthly meters.
 * Replays play from the client's blob: URL, so a real listener fetches a take about once.
 */
export const LISTEN_PER_HOUR = 300;
export const LISTEN_PER_FILE_PER_HOUR = 10;
export const LISTEN_PER_DAY = { conductor: 300, assistant: 120, member: 40 } as const;
export const MIDI_PER_HOUR = 600;
export const MIDI_PER_DAY = 300;
/** A missing object younger than this answers 503, older 410 + "missing" (D56). */
export const MISSING_GRACE_MS = 10 * 60_000;
/** D50: "Portalda kayıt yok" rows only for homework due in this window. */
export const NO_TAKE_WINDOW_MS = 30 * 24 * 3_600_000;
/** D51. */
export const COMMENTED_LIST_MAX = 100;

export const UPLOAD_ID_HEADER = "X-Upload-Id";
export const DURATION_HEADER = "X-Recording-Duration-Ms";

/** Test-only hooks, honoured only outside production on a file: database (D21, D37). */
export const STORAGE_FAULT_COOKIE = "arkhe_e2e_storage_fault";
export const RECORDER_LIMIT_COOKIE = "arkhe_e2e_recorder_limit";

/** `code` of every failed upload response; the client acts on it, never on the text. */
export type UploadCode =
  | "origin"
  | "auth"
  | "bad_request"
  | "not_found"
  | "forbidden"
  | "locked"
  | "limit"
  | "rate"
  | "empty"
  | "type"
  | "size"
  | "quota"
  | "storage"
  | "disabled"
  | "conflict";

export type UploadResult = {
  id: string;
  uploadedAt: string;
  durationMs: number | null;
  sizeBytes: number;
  contentType: RecordingType;
  replaced: boolean;
  late: boolean;
  uploadsUsed: number;
};
