# Phase 9: database plan (DBA)

Author: arkhe-dba. Date: 2026-10-21.

Inputs:
- `po-spec.md` (59 ACs; §7 q2 is mine), `backend.md` (§8.1, §15, §16 ask me things), `ui.md` (§9.2 cleanup order, §11 @dba), `ux.md` (read, no DB point)
- `design/phase-4/po-spec.md` and the code it became: `src/db/schema.ts` (`submissions` and its 8 CHECKs), `src/app/(portal)/odevler/actions.ts`, `src/lib/homework/{queries,eligibility}.ts`
- Phase 8 `db.md` (the trigger precedent in 0008) and Phase 8b `db.md` (0009, the cleanup order)
- `scripts/{homework-fixture.mjs,finance-fixture.mjs,seed.ts,db-check.ts,db-restore.ts,fixture-guard.mjs}`, `src/lib/backup/dump.ts`, `e2e/lib.mjs` `cleanup()`, `e2e/prod.mjs`

How I verified it (scratch only: I never wrote to `data/arkhe.db`, `src/` or `drizzle/`, and ran no git):
- Started from the 8b scratch DB (`dba8b/copy.db`, migrations 0000–0009, 10/10).
- Put the Drizzle code of §2 into a **copy** of the 8b `schema.ts`, ran the real `drizzle-kit generate --name phase9_media` against a copy of `drizzle/`, appended the four triggers of §3, then `drizzle-kit migrate`: **11/11**, `foreign_key_check` empty, `db:check` ok. Grep of the SQL for `ALTER|DROP|__new_`: **0**. The file has 7 `CREATE TABLE`, 16 indexes, 4 triggers.
- **97 accept/reject direct writes, 0 surprises** (66 of them are rejects, §8).
- Confirmed in libSQL that an FK **cascade from `assignments` and from `pieces` fires the child's `AFTER DELETE` trigger** (backend §8.1 asked): deleting a homework with a live take, a replaced take, a self-FK chain and notes queued exactly the one live key; deleting a piece with 3 MIDI files queued 3.
- Simulated the D26 seed and ran every review query of §5 against it: the counts in §11 come from those runs.
- Volume: 1 914 recordings (445 with live audio), 2 784 notes, 80 homework, 6 000 storage events, 1 500 queue rows, 100 MIDI files, `ANALYZE`d. Every query of §5–§6 runs in **≤ 2 ms** warm; plans in §7.
- `dumpDatabase` → `db:restore` → `db:check` round trip: 40 tables, the 6 triggers (2 from 0008 + 4) restored after the data, unique keys still enforced, the triggers fire on the restored copy.
- The e2e cleanup order of §12 on a copy holding e2e assistants, notes in both directions, e2e takes and MIDI: passes; the two wrong orders fail on the FKs.

---

## 0. Summary

- **Seven new tables, four triggers, nothing on existing tables.** `recordings` (one row per upload, kept for ever), `assistant_notes`, `listening_assistants`, `midi_files`, `storage_deletions` (the queue), `storage_events` (our Blob operation counter), `storage_sweeps` (the "Son temizlik" line). `submissions` keeps every column and CHECK; the recorder writes it exactly like `submitAssignment` does (§4).
- **The queue is filled by triggers** (backend's preference, and safer): `AFTER UPDATE OF audio_deleted_at` and `AFTER DELETE` on `recordings`, `AFTER DELETE` on `midi_files`. So every path, cascades from `assignments` and `pieces` and a raw `delete` in the fixtures included, queues its file in the same statement. A fourth `BEFORE UPDATE` trigger makes audio deletion final (a deleted take can't come back to life under a key that is queued for deletion).
- **No orphan window at all:** an upload first writes a *hold* row for its fresh key (`not_before = now + 1 h`), then puts the file, then its transaction deletes the hold and inserts the recording. A crash anywhere leaves a queued key that the sweep removes after an hour. So backend §15 q9 ("an `uploading` state") is answered with no extra state and no extra sweep step.
- **Retention is stored as the Istanbul day** (`recordings.delete_on`, `YYYY-MM-DD`): the day the page promises is the day the sweep deletes (`delete_on <= today`). The 90/120 days live in app code, not in a CHECK, so a shorter retention later (PO risk 3) needs no migration.
- **Visibility is in the queries** (§5): the assistant's queries never select `feedback` or another assistant's notes; the singer's queries never touch `assistant_notes`; `storage_key` is selected by exactly one function (the file route).
- **Backups:** every new table is in the encrypted dump automatically (`dump.ts` takes all tables). Audio is not. A restore therefore may hold rows whose files are gone; the route marks them `missing` on first play (§10).
- **Seed:** `asistan@arkhe.local` plus 7 recordings and 1 note on existing fixture submissions, and 2 MIDI files. One existing submission gains a conductor comment (E · Ayşe), because no other fixture row can give "commented, deletion date in the future" without a new submission (§11, @po).
- **Cleanup order** (§12) works with cascade + triggers, so `clearMedia` only has to remove what points at `@e2e.test` users; the files are reconciled against live rows at the end.

---

## 1. Answers to @po §7 q2

1. **Recordings: history, not "current only + counter".** One row per upload, never deleted by the app, the current take marked by `replaced_at is null` (partial unique index). Reasons:
   - D7's 5-upload cap must survive a `Sil` (otherwise "upload, delete, upload" is endless). `count(*)` per slot is that counter, with no second source of truth.
   - D8's "the notes stay and are tagged `Önceki kayda yazıldı`" needs the old take's id to exist: a note points at the take it was written on.
   - D17 keeps the metadata for ever ("duration, size, type, upload and deletion dates").
   - `Değiştirildi · <tarih>` is `replaces_id is not null` on the current take.
   - Cost: ~150 rows a month, ~200 bytes each. Nothing.
2. **Assistant notes keyed by the slot, not the take:** PK (`assignment_id`, `singer_id`, `assistant_id`), plus `recording_id` = the take it was written on. One note per (recording slot, assistant) as D10 says; a re-take keeps the note and the conductor sees `Önceki kayda yazıldı` when `recording_id <> current id`.
3. **Assistants with scope:** one row per (assistant, voice part). "Tüm partisyonlar" = the four rows. No rows = not an assistant. See §2.2 for why not `all_parts` + a child table.
4. **MIDI files:** `midi_files`, `voice_part` null = Tutti (the `piece_links` convention), cascade from `pieces` with a trigger.
5. **Deletion queue: triggers, not actions.** Verified that FK cascades fire them in libSQL. The only app-side writes to the queue are the upload hold and its release (§4.1).
6. **Usage log:** `storage_events` (`put`/`get`, bytes, time; no user, no key), pruned by the sweep. The gauge is four aggregate subqueries over two covering indexes (§5.9).
7. **Seed and documented counts:** §11.

---

## 2. Schema

### 2.1 Drizzle (`src/db/schema.ts`, after the Phase 8b tables)

No new import (`AnySQLiteColumn`, `primaryKey`, `uniqueIndex`, `check`, `index` are there already). It uses the existing helpers `now`, `createdAt`, `inList` and `day`. `recordings.id` and `midi_files.id` have **no** `$defaultFn`: the id is the client's upload id (backend §3.5, idempotent retries); the storage key is a separate server-made uuid.

```ts

// ------------------------------------------------- Phase 9: recordings, assistant review, MIDI files

export const RECORDING_TYPES = [
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/webm",
  "audio/ogg",
  "audio/wav",
] as const;
// Detected type -> extension of the storage key; recordings_storage_key_check mirrors this map.
export const RECORDING_EXTENSIONS = {
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
} as const satisfies Record<(typeof RECORDING_TYPES)[number], string>;
export const RECORDING_DELETE_REASONS = [
  "replaced",
  "withdrawn",
  "conductor",
  "retention",
  "early",
  "missing",
] as const;
export const STORAGE_AREAS = ["recording", "midi"] as const;
export const STORAGE_EVENT_KINDS = ["put", "get"] as const;
export const DELETION_STATES = ["pending", "done"] as const;
export const STORAGE_ERROR_KINDS = [
  "unavailable",
  "suspended",
  "rate_limited",
  "auth",
  "fault",
  "unknown",
] as const;
export const SWEEP_REASONS = ["cron", "early"] as const;
export const SWEEP_STATUSES = ["ok", "partial", "failed"] as const;
export const RECORDING_MAX_BYTES = 4_194_304;
export const MIDI_MAX_BYTES = 1_048_576;
export type RecordingType = (typeof RECORDING_TYPES)[number];
export type RecordingDeleteReason = (typeof RECORDING_DELETE_REASONS)[number];
export type StorageArea = (typeof STORAGE_AREAS)[number];

const uuidPart = (expr: string) =>
  sql.raw(`length(${expr}) = 36 and ${expr} not glob '*[^0-9a-f-]*'`);
const recordingExt = sql.raw(
  `case content_type ${RECORDING_TYPES.map((t) => `when '${t}' then '${RECORDING_EXTENSIONS[t]}'`).join(" ")} end`,
);
const bytes = (column: string, max: number) =>
  sql.raw(`typeof(${column}) = 'integer' and ${column} between 1 and ${max}`);

// One row per upload, never deleted by the app (only by the cascade from assignments): the current
// take, earlier takes, and the metadata of audio that is gone. Triggers in 0010 queue the file.
export const recordings = sqliteTable(
  "recordings",
  {
    // The client's X-Upload-Id (idempotent retries); the storage key is a separate server uuid.
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // The take this one replaced (Değiştir); null for a first upload or an upload after Sil.
    replacesId: text("replaces_id").references((): AnySQLiteColumn => recordings.id),
    // Server-only: never selected for a page, never sent to a browser.
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type", { enum: RECORDING_TYPES }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Client-reported, clamped; display only.
    durationMs: integer("duration_ms"),
    uploadedAt: integer("uploaded_at", { mode: "timestamp" }).notNull().default(now),
    // Null = the current take of (assignment, singer).
    replacedAt: integer("replaced_at", { mode: "timestamp" }),
    // First conductor comment while this take was current; editing doesn't move it.
    commentedAt: integer("commented_at", { mode: "timestamp" }),
    // Istanbul day the sweep deletes the audio: commented +90 d, else uploaded +120 d (set by the app).
    deleteOn: text("delete_on").notNull(),
    audioDeletedAt: integer("audio_deleted_at", { mode: "timestamp" }),
    deletedReason: text("deleted_reason", { enum: RECORDING_DELETE_REASONS }),
  },
  (t) => [
    uniqueIndex("recordings_current_idx")
      .on(t.assignmentId, t.userId)
      .where(sql`replaced_at is null`),
    index("recordings_slot_idx").on(t.assignmentId, t.userId, t.uploadedAt),
    index("recordings_user_idx").on(t.userId),
    uniqueIndex("recordings_replaces_idx")
      .on(t.replacesId)
      .where(sql`replaces_id is not null`),
    uniqueIndex("recordings_storage_key_idx").on(t.storageKey),
    // Sweep, storage gauge and review queues only look at live audio.
    index("recordings_live_idx")
      .on(t.deleteOn, t.sizeBytes)
      .where(sql`audio_deleted_at is null`),
    index("recordings_commented_idx")
      .on(t.commentedAt)
      .where(sql`audio_deleted_at is null and commented_at is not null`),
    check("recordings_id_check", uuidPart("id")),
    check("recordings_content_type_check", sql`content_type in (${inList(RECORDING_TYPES)})`),
    check(
      "recordings_storage_key_check",
      sql`substr(storage_key, 1, 11) = 'recordings/' and ${uuidPart("substr(storage_key, 12, 36)")} and substr(storage_key, 48) = '.' || ${recordingExt}`,
    ),
    check("recordings_size_check", bytes("size_bytes", RECORDING_MAX_BYTES)),
    check(
      "recordings_duration_check",
      sql`duration_ms is null or (typeof(duration_ms) = 'integer' and duration_ms between 0 and 600000)`,
    ),
    check("recordings_replaces_self", sql`replaces_id is null or replaces_id <> id`),
    check(
      "recordings_replaced",
      sql`replaced_at is null or (replaced_at >= uploaded_at and audio_deleted_at is not null and commented_at is null)`,
    ),
    check("recordings_commented", sql`commented_at is null or commented_at >= uploaded_at`),
    check(
      "recordings_delete_on",
      sql`${day("delete_on")} and date(delete_on) is delete_on and delete_on > date(uploaded_at, 'unixepoch')`,
    ),
    check(
      "recordings_deleted",
      sql`(audio_deleted_at is null) = (deleted_reason is null) and (deleted_reason is null or deleted_reason in (${inList(RECORDING_DELETE_REASONS)})) and (audio_deleted_at is null or audio_deleted_at >= uploaded_at)`,
    ),
  ],
);

// The conductor's appointment: one row per (assistant, voice part in scope); "Tüm partisyonlar" = all
// four rows. No rows = not an assistant. Ignored while the user is inactive or the conductor.
export const listeningAssistants = sqliteTable(
  "listening_assistants",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    voicePart: text("voice_part", { enum: VOICE_PARTS }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.voicePart] }),
    // "Who can listen to me": the singer's part -> assistants.
    index("listening_assistants_part_idx").on(t.voicePart, t.userId),
    check("listening_assistants_voice_check", sql`voice_part in (${inList(VOICE_PARTS)})`),
  ],
);

// Private to the conductor and the note's author. Kept when the take is replaced; recording_id is
// the take it was written on ("Önceki kayda yazıldı").
export const assistantNotes = sqliteTable(
  "assistant_notes",
  {
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    singerId: text("singer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assistantId: text("assistant_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // No action: recording rows only go with their assignment, which takes the note too.
    recordingId: text("recording_id")
      .notNull()
      .references(() => recordings.id),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.assignmentId, t.singerId, t.assistantId] }),
    index("assistant_notes_assistant_idx").on(t.assistantId, t.updatedAt),
    index("assistant_notes_singer_idx").on(t.singerId),
    index("assistant_notes_recording_idx").on(t.recordingId),
    check("assistant_notes_not_own", sql`assistant_id <> singer_id`),
    check(
      "assistant_notes_body",
      sql`length(trim(body)) between 1 and 1000 and length(body) <= 1000`,
    ),
    check("assistant_notes_updated", sql`updated_at >= created_at`),
  ],
);

// Null voice_part = Tutti (as in piece_links). Hard-deleted; a trigger in 0010 queues the file.
export const midiFiles = sqliteTable(
  "midi_files",
  {
    id: text("id").primaryKey(),
    pieceId: text("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    voicePart: text("voice_part", { enum: VOICE_PARTS }),
    label: text("label"),
    storageKey: text("storage_key").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("midi_files_piece_idx").on(t.pieceId, t.voicePart),
    uniqueIndex("midi_files_storage_key_idx").on(t.storageKey),
    check("midi_files_id_check", uuidPart("id")),
    check(
      "midi_files_voice_part_check",
      sql`voice_part is null or voice_part in (${inList(VOICE_PARTS)})`,
    ),
    check(
      "midi_files_label_length",
      sql`label is null or (length(trim(label)) between 1 and 60 and length(label) <= 60)`,
    ),
    check(
      "midi_files_storage_key_check",
      sql`substr(storage_key, 1, 5) = 'midi/' and ${uuidPart("substr(storage_key, 6, 36)")} and substr(storage_key, 42) = '.mid'`,
    ),
    check("midi_files_size_check", bytes("size_bytes", MIDI_MAX_BYTES)),
  ],
);

// Every stored key that isn't live. Filled by the 0010 triggers, and by uploads: a hold row before
// the put (not_before = now + 1 h) that the upload's transaction deletes when the key becomes live.
export const storageDeletions = sqliteTable(
  "storage_deletions",
  {
    storageKey: text("storage_key").primaryKey(),
    area: text("area", { enum: STORAGE_AREAS }).notNull(),
    // Still occupies the store until done: counted by the Depolama meter.
    sizeBytes: integer("size_bytes").notNull(),
    state: text("state", { enum: DELETION_STATES }).notNull().default("pending"),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull().default(now),
    // Upload hold: the sweep leaves the key alone until then.
    notBefore: integer("not_before", { mode: "timestamp" }),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp" }),
    lastError: text("last_error", { enum: STORAGE_ERROR_KINDS }),
    doneAt: integer("done_at", { mode: "timestamp" }),
  },
  (t) => [
    index("storage_deletions_pending_idx")
      .on(t.requestedAt)
      .where(sql`state = 'pending'`),
    index("storage_deletions_done_idx")
      .on(t.doneAt)
      .where(sql`state = 'done'`),
    check("storage_deletions_area_check", sql`area in (${inList(STORAGE_AREAS)})`),
    check("storage_deletions_state_check", sql`state in (${inList(DELETION_STATES)})`),
    check(
      "storage_deletions_key_check",
      sql`(area = 'recording' and substr(storage_key, 1, 11) = 'recordings/' and ${uuidPart("substr(storage_key, 12, 36)")} and substr(storage_key, 48) in ('.m4a', '.mp3', '.aac', '.webm', '.ogg', '.wav')) or (area = 'midi' and substr(storage_key, 1, 5) = 'midi/' and ${uuidPart("substr(storage_key, 6, 36)")} and substr(storage_key, 42) = '.mid')`,
    ),
    check("storage_deletions_size_check", bytes("size_bytes", RECORDING_MAX_BYTES)),
    // No order check against requested_at: the triggers use the DB clock, the app its own.
    check("storage_deletions_done", sql`(state = 'done') = (done_at is not null)`),
    check(
      "storage_deletions_attempts",
      sql`typeof(attempts) = 'integer' and attempts >= 0 and (attempts = 0) = (last_attempt_at is null) and (last_error is null or (last_error in (${inList(STORAGE_ERROR_KINDS)}) and attempts >= 1))`,
    ),
    check("storage_deletions_not_before", sql`not_before is null or state = 'pending'`),
  ],
);

// Our own count of Blob operations (the gauge's rolling 30 days). No user, no key. Pruned by the sweep.
export const storageEvents = sqliteTable(
  "storage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: STORAGE_EVENT_KINDS }).notNull(),
    bytes: integer("bytes").notNull(),
    at: integer("at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    index("storage_events_kind_at_idx").on(t.kind, t.at, t.bytes),
    check("storage_events_kind_check", sql`kind in (${inList(STORAGE_EVENT_KINDS)})`),
    check("storage_events_bytes_check", bytes("bytes", RECORDING_MAX_BYTES)),
  ],
);

// One row per finished sweep (daily cron or early clean): "Son temizlik: <tarih> · <n> dosya silindi".
export const storageSweeps = sqliteTable(
  "storage_sweeps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reason: text("reason", { enum: SWEEP_REASONS }).notNull(),
    status: text("status", { enum: SWEEP_STATUSES }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp" }).notNull(),
    expired: integer("expired").notNull(),
    deleted: integer("deleted").notNull(),
    failed: integer("failed").notNull(),
  },
  () => [
    check("storage_sweeps_reason_check", sql`reason in (${inList(SWEEP_REASONS)})`),
    check("storage_sweeps_status_check", sql`status in (${inList(SWEEP_STATUSES)})`),
    check("storage_sweeps_time", sql`finished_at >= started_at`),
    check(
      "storage_sweeps_counts",
      sql`typeof(expired) = 'integer' and typeof(deleted) = 'integer' and typeof(failed) = 'integer' and expired >= 0 and deleted >= 0 and failed >= 0`,
    ),
  ],
);
```

There is no literal `;` in any CHECK (drizzle-kit cuts CHECK text at one). Generated names and SQL are as in my scratch `0010`; regenerate in the repo (§9).

### 2.2 Column semantics

**`recordings`**
- **`id`**: the client's `X-Upload-Id` (uuid, CHECKed lower-case hex). A replay with the same id hits the PK (backend §3.5). **`storage_key`** is a different, server-made uuid: `recordings/<uuid>.<ext>`, the extension pinned by CHECK to `content_type`. A client can therefore never choose (or collide with) a pathname. No name, title or user id ever appears in it (AC 1).
- **`content_type`**: the sniffed type (D6), one of six. **`size_bytes`**: 1 … 4 194 304, integer (`typeof` guard, like the money CHECKs). **`duration_ms`**: null or 0 … 600 000 (backend §3.4: clamped, display only).
- **`replaced_at`** null = the current take; set by `Değiştir` (`replaced`), by `Sil`/fallback `Geri al` (`withdrawn`), and by a manager's unmark of a submission whose audio is already gone (§4.2). CHECK: a replaced take has no audio and no `commented_at`.
- **`replaces_id`**: the previous take, only for `Değiştir`. Unique (a take is replaced at most once), not self. FK without action: rows only go with their assignment, in one statement.
- **`commented_at`**: the conductor's **first** comment while this take is current (D17). Editing the comment doesn't move it; deleting the comment clears it. Never on a replaced take (CHECK).
- **`delete_on`**: the Istanbul day the sweep deletes the audio. App-computed: `istanbulDateOf(commented_at) + 90 d`, else `istanbulDateOf(uploaded_at) + 120 d` (backend §8.2). CHECK: a real calendar day (`date(x) is x`), after the upload day. This is what `Bu kayıt <tarih> tarihinde silinecek.` shows.
- **`audio_deleted_at` + `deleted_reason`**: set together (CHECK), never cleared (trigger). Reasons: `replaced`, `withdrawn`, `conductor` (`Kaydı sil`), `retention` (sweep), `early` (early clean), `missing` (the store didn't have the file, e.g. after a restore, §10).
- **What is never stored:** file names (the download name is built from the piece title and the singer's name at request time), the browser's claimed type, IPs.

**`listening_assistants`**: one row per (assistant, part).
- Why not `all_parts` + a parts table (backend §15 q3): with two tables, "all_parts xor ≥ 1 part" is a cross-table rule that no CHECK can hold, and the scope query needs an `or`. With rows per part, "≥ 1 part" is structural (no rows = not an assistant), the scope test is one indexed `exists`, and `Tüm partisyonlar` is simply "all four rows", which the page shows as that label. The four parts are fixed by the domain, so the two meanings never differ.
- `user_id` → users **restrict** (AC 56). `created_by` → users restrict (the conductor). "Appointed at" = `min(created_at)`.
- The DB can't refuse a conductor or an inactive user here (no cross-table CHECK). The action refuses them; every read joins `users` with `is_active = 1 and role in ('member','board')`, so an assistant who later becomes conductor or leaves is **ignored, not deleted** (D9).

**`assistant_notes`**: PK (`assignment_id`, `singer_id`, `assistant_id`); `recording_id` = the take it was written on; body 1–1000 after trim (and ≤ 1000 raw); `assistant_id <> singer_id`. `assignment_id` cascades (D17/AC 40: deleting the homework deletes the notes), users restrict, `recording_id` no action (verified inside the assignment cascade: no FK error at statement end).

**`midi_files`**: `id` = the form's upload id; `voice_part` null = Tutti (the `piece_links` convention; backend's `'tutti'` code maps to null); `label` null or 1–60; `storage_key` `midi/<uuid>.mid` (server uuid); 1 … 1 048 576 bytes; `piece_id` cascade (D24); `created_by` restrict. The 20-per-piece cap is an app rule inside `writeTx` (IMMEDIATE serialises writers, so check-then-insert is race-free).

**`storage_deletions`** (the queue), PK `storage_key`:
- `area` must match the key prefix and a known extension (CHECK), so a path like `recordings/../../arkhe.db` can't be queued (and the local driver can't be tricked into deleting outside `data/uploads/`).
- `size_bytes`: pending rows still occupy the store, so the `Depolama` meter adds them.
- `state` `pending|done` with `done_at` (CHECK, AC 56 "a key and a state"). `attempts`/`last_attempt_at` go together; `last_error` is a `StorageError.kind` code only (CHECK), never a message (a Blob error message can contain the URL; backend §14).
- `not_before`: the upload hold (§4.1); only on pending rows.
- **No CHECK compares `done_at` with `requested_at`:** the trigger rows take the DB clock (`unixepoch()`), the app writes its own; on Turso those are two machines. (My first draft had that CHECK and my own volume script tripped it.)
- No FK: a queued key belongs to a row that is already gone, or to none (a failed upload).

**`storage_events`**: `put` (logged before the put, failed puts included: Vercel counts them) and `get` (after a successful delivery), with bytes. No user id and no key (backend §14). Pruned after 40 days.

**`storage_sweeps`**: one row per finished sweep (`cron` or `early`), with counts and `ok|partial|failed`. The newest is the "Son temizlik" line. Pruned to the last 60.

### 2.3 Time, money, deletes

- **Instants** are unix seconds UTC (Drizzle `timestamp` mode), as everywhere. **`delete_on`** is a plain Istanbul calendar day (`YYYY-MM-DD`), like `occurred_on`.
- **No money** in this phase.
- **Soft vs hard:** recordings are soft (the row stays, the audio goes; only the assignment cascade removes rows). Notes, scopes and MIDI rows are hard-deleted (their files via the triggers). Queue `done` rows are pruned after 30 days, events after 40 days, sweeps beyond 60 rows. Users are never deleted (restrict everywhere).

---

## 3. Triggers (append to the generated `0010` by hand, exactly as in 0008)

```sql
--> statement-breakpoint
CREATE TRIGGER `recordings_queue_on_audio_delete` AFTER UPDATE OF audio_deleted_at ON `recordings`
WHEN OLD.audio_deleted_at IS NULL AND NEW.audio_deleted_at IS NOT NULL
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (NEW.storage_key, 'recording', NEW.size_bytes); END;--> statement-breakpoint
CREATE TRIGGER `recordings_queue_on_delete` AFTER DELETE ON `recordings`
WHEN OLD.audio_deleted_at IS NULL
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (OLD.storage_key, 'recording', OLD.size_bytes); END;--> statement-breakpoint
CREATE TRIGGER `recordings_audio_final` BEFORE UPDATE OF audio_deleted_at, storage_key ON `recordings`
WHEN (OLD.audio_deleted_at IS NOT NULL AND NEW.audio_deleted_at IS NULL) OR NEW.storage_key IS NOT OLD.storage_key
BEGIN SELECT RAISE(ABORT, 'recordings_audio_final'); END;--> statement-breakpoint
CREATE TRIGGER `midi_files_queue_on_delete` AFTER DELETE ON `midi_files`
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (OLD.storage_key, 'midi', OLD.size_bytes); END;
```

- **Plain `INSERT`, not `INSERT OR IGNORE`** (backend §15 q5 suggested ignore). `OR IGNORE` also swallows CHECK failures, which would silently orphan a file. A duplicate can't happen: keys are fresh uuids, a live key has no queue row (the hold is deleted when the key goes live, §4.1), and audio deletion is final.
- The `;` inside `BEGIN … END` is safe (the migrator splits on `--> statement-breakpoint`; verified with the real `drizzle-kit migrate`, as in 0008).
- `requested_at` takes its default (`unixepoch()`), not `NEW.audio_deleted_at`: e2e arranges past deletion dates, and the queue time is when it was queued.
- **Rebuild warning:** add `// Triggers in 0010 queue files on audio delete and row delete; a drizzle "__new_recordings" rebuild would silently drop them.` above `recordings` and the same above `midi_files` (the 0008 lesson). `db:check` catches it (§10).

---

## 4. Writes: recipes and transactions

All writes that depend on a read run in `writeTx` (`BEGIN IMMEDIATE`). `:now` is one `now()` per action; `:today` its Istanbul day.

### 4.1 Upload (recording route; MIDI the same with `area = 'midi'`)

1. Read-only pre-checks (backend §3.2 step 5): eligibility, `feedback is null`, `count(*) < 5` for the slot (`recordings_slot_idx`, covering), quota.
2. `key = recordings/<server uuid>.<ext>`. **Hold**, in one `db.batch`: `insert into storage_events (kind, bytes) values ('put', :size)` and `insert into storage_deletions (storage_key, area, size_bytes, not_before) values (:key, 'recording', :size, :now + 3600)`.
3. `driver.put(key)`. On any failure (also a timeout: the put may have landed): `update storage_deletions set not_before = null where storage_key = :key` → the sweep deletes it (a delete of a missing object is a free no-op), and answer with the D21 message. `recordings`/`submissions` untouched (AC 47).
4. `writeTx`:
   1. re-check eligibility, `feedback is null`, slot count < 5;
   2. the current take, if any: `update recordings set replaced_at = :now, audio_deleted_at = coalesce(audio_deleted_at, :now), deleted_reason = coalesce(deleted_reason, 'replaced') where assignment_id = :a and user_id = :me and replaced_at is null returning id` (its key is queued by the trigger when it still had audio). This must come **before** the insert (the partial unique index);
   3. `delete from storage_deletions where storage_key = :key and state = 'pending'` — must affect exactly 1 row, else throw (the hold was swept: impossible within an hour, but never make a live row for a key that is being deleted);
   4. `insert into recordings (id, assignment_id, user_id, replaces_id, storage_key, content_type, size_bytes, duration_ms, uploaded_at, delete_on) values (:uploadId, :a, :me, :oldId, :key, :type, :size, :ms, :now, :today + 120 d)`;
   5. the submission, **exactly `submitAssignment`'s upsert**: `insert … (submitted_at = :now, method = 'self') on conflict do update set submitted_at = :now, method = 'self', marked_by = null where submitted_at is null`. A row with `submitted_at is null` always has feedback (`submissions_not_empty`), and feedback means the lock, so in practice an existing row is never changed: the first submission time and a manual mark stay (D1, AC 11, AC 36).
5. If step 4 throws (refusal, PK replay race, DB error): `update storage_deletions set not_before = null where storage_key = :key`, then `drainKeys([key])`.
6. After commit: `drainKeys([oldKey])` best effort.

A crash between 2 and 4 leaves the hold; after an hour the sweep deletes the key. So **every key in the store is live or queued, always** (backend §8.1's invariant, now without exception), and the gauge counts an in-flight upload.

### 4.2 The other writes

| Action | Statements (in `writeTx` unless noted) | Notes |
|---|---|---|
| Singer `Sil` / fallback `Geri al` with a take (`deleteMyRecording`, `undoSubmission`) | lock check (`feedback is null`); `update recordings set replaced_at = :now, audio_deleted_at = coalesce(audio_deleted_at, :now), deleted_reason = coalesce(deleted_reason, 'withdrawn') where … and replaced_at is null`; `delete from submissions where assignment_id = :a and user_id = :me and method = 'self' and feedback is null` | **`method = 'manual'` is kept**: a manager's mark existed before the take and stays (AC 36's logic in reverse). @po §13. |
| Conductor `Kaydı sil` | `update recordings set audio_deleted_at = :now, deleted_reason = 'conductor' where id = :id and audio_deleted_at is null` (one statement) | Submission, comment, notes stay (D17). The take stays current, so the singer sees `Ses dosyası silindi`. |
| `saveFeedback`, null → text | the Phase 4 upsert; `update recordings set commented_at = :now, delete_on = :today + 90 d where assignment_id = :a and user_id = :u and replaced_at is null and commented_at is null` | Same tx: the comment and the deletion date can't disagree (db:check invariant 2). |
| `saveFeedback`, text → other text | the Phase 4 update only | `commented_at`/`delete_on` don't move (D17). |
| `saveFeedback`, text → empty | the Phase 4 delete/update; `select uploaded_at …`, then `update recordings set commented_at = null, delete_on = :uploadDay + 120 d where … replaced_at is null` | If that day is already past, the next sweep deletes the audio: that is the 120-day rule applied honestly. |
| Manager unmark (`setSubmissionFor(…, false)`) | current take **with audio** → refuse (backend's copy); current take **without** audio → the Phase 4 statements plus `update recordings set replaced_at = :now, commented_at = null where … and replaced_at is null` | Keeps invariant 1 (§10): no current take without a submitted submission. |
| Assistant note save | re-check: effective scope, not own, current take id = the form's `recordingId`, audio present, `feedback is null`; `insert … on conflict (assignment_id, singer_id, assistant_id) do update set body = excluded.body, recording_id = excluded.recording_id, updated_at = excluded.updated_at` | Saving moves the note onto the current take (the tag `Önceki kayda yazıldı` disappears). Re-saving the same text: skip the write. |
| Assistant note delete | lock check; `delete from assistant_notes where assignment_id = ? and singer_id = ? and assistant_id = :me` | |
| Add / edit / remove assistant | add: refuse if rows exist (`Bu kişi zaten asistan.`), insert 1–4 rows; edit: `db.batch([delete …, insert …])`; remove: `delete from listening_assistants where user_id = ?` | Notes stay (FK is on users, not on the appointment). |
| `deleteAssignment` | unchanged | `recordings` and `assistant_notes` cascade; the trigger queues live keys. Confirm copy counts: `count(*) … submitted_at is not null` and `count(*) from recordings where assignment_id = ? and audio_deleted_at is null` (`recordings_slot_idx` prefix). |
| `deletePiece`, `deleteMidi` | unchanged / one `delete` | `midi_files` cascade or direct; trigger queues. |
| Sweep, early clean | §6 | one statement each, no interactive tx |

**Ordering rule for anything that deletes rows by hand** (fixtures, e2e): notes before recordings (no-action FK), recordings/notes/scopes/MIDI before their users (restrict).

---

## 5. Visibility rules as queries

Verified against the D26 seed (§11) and at volume (§7). `:me` is the session user. **Every assistant check joins `users` for `is_active = 1 and role in ('member','board')`**, so a removed, deactivated or promoted assistant matches nothing.

### 5.1 Effective scope (assistant pages redirect when empty)
```sql
select la.voice_part from listening_assistants la join users a on a.id = la.user_id
where la.user_id = :me and a.is_active = 1 and a.role in ('member', 'board')
```

### 5.2 May `:me` play recording `:id`? (`/api/dosya/kayit/<id>`; no row → 404, then `audio_deleted_at` → 410)
```sql
select r.id, r.content_type, r.size_bytes, r.audio_deleted_at, r.storage_key
from recordings r
join users s on s.id = r.user_id
left join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
where r.id = :id
  and (r.user_id = :me
       or exists (select 1 from users v where v.id = :me and v.role = 'conductor' and v.is_active = 1)
       or (r.replaced_at is null and r.user_id <> :me and sub.feedback is null and exists (
             select 1 from listening_assistants la join users a on a.id = la.user_id
             where la.user_id = :me and la.voice_part = s.voice_part
               and a.is_active = 1 and a.role in ('member', 'board'))))
```
- The authorization **is** the `where`: one query, no "load then check" gap. Checked on the seed: owner, sef@ and asistan@ get the alto take; yk@, another alto, a tenor get nothing; asistan@ gets nothing on a tenor take, on a commented take (backend §16 q5) and after deactivation.
- This is the **only** query that selects `storage_key`. Put it in a `server-only` module of its own (the `rehearsal_secrets` lesson); page queries list columns explicitly and never `select()` a whole `recordings` row.

### 5.3 Who can listen to me (D11 transparency text)
```sql
select a.name from listening_assistants la join users a on a.id = la.user_id
where la.voice_part = :myPart and la.user_id <> :me and a.is_active = 1 and a.role in ('member', 'board')
order by a.name
```
Names only. It is the one place a singer's page reads `listening_assistants`; it never reads `assistant_notes`.

### 5.4 Assistant `Dinlenecek` (and the home card / `Dinleme (<n>)` count)
```sql
select r.id, r.assignment_id, r.user_id, s.name, s.voice_part, r.duration_ms, r.uploaded_at,
       sub.submitted_at > asg.due_at as late,
       exists (select 1 from assistant_notes n where n.assignment_id = r.assignment_id
               and n.singer_id = r.user_id and n.assistant_id = :me) as new_take
from recordings r
join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
join assignments asg on asg.id = r.assignment_id
join users s on s.id = r.user_id
where r.replaced_at is null and r.audio_deleted_at is null
  and sub.submitted_at is not null and sub.feedback is null
  and r.user_id <> :me
  and s.voice_part in (<5.1>)
  and not exists (select 1 from assistant_notes n where n.assignment_id = r.assignment_id
                  and n.singer_id = r.user_id and n.assistant_id = :me and n.recording_id = r.id)
order by asg.due_at desc, s.name
```
`new_take` = I have a note, but on an older take → `Yeni kayıt` (D8, AC 26). `Portalda kayıt yok` can't appear (inner join on a live take, AC 22). `sub.feedback is null` is only ever used as a boolean here.

### 5.5 Assistant `Not yazdıklarım`
```sql
select n.assignment_id, n.singer_id, n.updated_at, r.id is not null and n.recording_id = r.id as on_current
from assistant_notes n
join submissions sub on sub.assignment_id = n.assignment_id and sub.user_id = n.singer_id
join users s on s.id = n.singer_id
left join recordings r on r.assignment_id = n.assignment_id and r.user_id = n.singer_id and r.replaced_at is null
where n.assistant_id = :me and sub.submitted_at is not null and sub.feedback is null
  and s.voice_part in (<5.1>)
order by n.updated_at desc
```

### 5.6 Assistant review page
- The take: §5.2's row minus `storage_key`, plus `replaces_id is not null` and `uploaded_at`.
- The submission: `submitted_at`, `submitted_at > due_at`, and **`feedback is not null as commented`**. Never `feedback`, `feedback_by`, `feedback_at`.
- The notes: `where assignment_id = ? and singer_id = ? and assistant_id = :me` (the PK). There is no query in the assistant path without `assistant_id = :me`, so another assistant's text, author or count can't reach the page (AC 24).

### 5.7 Conductor `Yorum bekleyen` (two indexed halves; the plain `or` version scans all homework)
```sql
-- takes with live audio, no comment
select r.assignment_id, r.user_id, r.id as recording_id, r.duration_ms, r.uploaded_at, sub.submitted_at
from recordings r
join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
where r.replaced_at is null and r.audio_deleted_at is null
  and sub.submitted_at is not null and sub.feedback is null
union all
-- recent submissions without live audio: "Portalda kayıt yok" (or "Ses dosyası silindi")
select sub.assignment_id, sub.user_id, r.id, null, null, sub.submitted_at
from assignments asg
join submissions sub on sub.assignment_id = asg.id
left join recordings r on r.assignment_id = sub.assignment_id and r.user_id = sub.user_id and r.replaced_at is null
where asg.due_at >= :now - 30 * 86400
  and sub.submitted_at is not null and sub.feedback is null
  and (r.id is null or r.audio_deleted_at is not null)
```
- **The 30-day window is a product choice I need from @po (§13 q1).** Without it, every Phase 4 submission ever made without a comment (hundreds after go-live) appears as `Portalda kayıt yok` and the conductor's default chip never empties.
- Note counts per row: one `group by` over `assistant_notes` for the listed slots (`select assignment_id, singer_id, count(*) … where (assignment_id, singer_id) in (…) group by 1, 2`), or a correlated `count(*)` on the PK prefix. **Not** one query per row.

### 5.8 Conductor `Asistan notu olanlar` and `data-review-badge`: the same predicate, so they can't disagree (AC 27)
```sql
select
  (select count(*) from recordings r
     join submissions sub on sub.assignment_id = r.assignment_id and sub.user_id = r.user_id
    where r.replaced_at is null and r.audio_deleted_at is null
      and sub.submitted_at is not null and sub.feedback is null
      and exists (select 1 from assistant_notes n where n.assignment_id = r.assignment_id and n.singer_id = r.user_id))
+ (select count(*) from assignments asg
     join submissions sub on sub.assignment_id = asg.id
    where asg.due_at >= :now - 30 * 86400
      and sub.submitted_at is not null and sub.feedback is null
      and not exists (select 1 from recordings r where r.assignment_id = sub.assignment_id and r.user_id = sub.user_id
                        and r.replaced_at is null and r.audio_deleted_at is null)
      and exists (select 1 from assistant_notes n where n.assignment_id = sub.assignment_id and n.singer_id = sub.user_id))
```
Runs in the layout for the conductor only (backend §6), wrapped in `cache()`.

`Yorumlananlar`: submissions with `feedback is not null`, on homework due in the last 180 days, `limit 200` (via `assignments_due_idx`), left-joined to the current take for `delete_on`/`audio_deleted_at`. It grows for ever otherwise.

Conductor review page notes: `select n.assistant_id, u.name, n.body, n.updated_at, n.recording_id = :currentId as on_current from assistant_notes n join users u on u.id = n.assistant_id where n.assignment_id = ? and n.singer_id = ? order by n.created_at`.

### 5.9 Storage gauge (`/odevler/depolama`, the 80/95/100 % guards)
```sql
select
  (select coalesce(sum(size_bytes), 0) from recordings where audio_deleted_at is null)
  + (select coalesce(sum(size_bytes), 0) from midi_files)
  + (select coalesce(sum(size_bytes), 0) from storage_deletions where state = 'pending') as stored_bytes,
  (select count(*) from storage_events where kind = 'put' and at > :now - 30 * 86400) as uploads,
  (select count(*) from storage_events where kind = 'get' and at > :now - 30 * 86400) as reads,
  (select 2 * coalesce(sum(bytes), 0) from storage_events where kind = 'get' and at > :now - 30 * 86400) as transfer_bytes
```
One round trip. The guards run it before every upload and every listen; that's fine (≤ 0.2 ms, covering indexes). The 95 % check is check-then-put, so two parallel uploads can overshoot by 8 MB; the 5 % margin (50 MB) absorbs that.

### 5.10 Other reads
- Roster `Kayıt · 0:05` (managers): `select user_id, id, duration_ms, audio_deleted_at from recordings where assignment_id = ? and replaced_at is null`: **one** query for the whole roster, next to `rosterFor`'s existing two. The board gets metadata only; the link to the review page is the conductor's (D13).
- Singer detail: the current take (`id, duration_ms, uploaded_at, replaces_id is not null, delete_on, audio_deleted_at`) and the slot count (for `<n>/5`), both by `(assignment_id, user_id)`.
- Piece detail MIDI: `select id, voice_part, label, size_bytes from midi_files where piece_id = ? and (voice_part is null or voice_part = ?) order by voice_part is not null, voice_part, label, created_at`; the homework's `MIDI'yi çal` is the same query `limit 1` preferring the part (`order by voice_part is null`).

### 5.11 What must never happen (review checklist for `review-db.md`)
- A singer or board path that imports `assistantNotes`.
- An assistant path that selects `submissions.feedback` (other than `is not null`), or reads notes without `assistant_id = :me`.
- Any page/RSC query that selects `storage_key`, or a `select()` without a column list on `recordings`/`midi_files`/`storage_deletions`.
- An authorization decided in JS from rows loaded without the user in the `where` (load-then-check is fine only if 404 is returned for every failing branch identically).

---

## 6. Retention and the sweep

- **Expire** (one statement; the trigger queues): `update recordings set audio_deleted_at = :now, deleted_reason = 'retention' where audio_deleted_at is null and delete_on <= :today` (`recordings_live_idx` range).
- **Early clean** (conductor): preview `select count(*), sum(size_bytes) from recordings where audio_deleted_at is null and commented_at is not null and commented_at < :cut30`, then the same `where` with `deleted_reason = 'early'` (`recordings_commented_idx`). `:cut30` = `istanbulToUtc(today − 29)` per backend §8.2.
- **Drain:** `select storage_key, area from storage_deletions where state = 'pending' and (not_before is null or not_before <= :now) order by requested_at limit 500`. Success: `update … set state = 'done', done_at = :now, attempts = attempts + 1, last_attempt_at = :now, last_error = null where storage_key in (…) and state = 'pending'`. Failure: `attempts = attempts + 1, last_attempt_at = :now, last_error = :kind`. The `state = 'pending'` guard makes a race between `drainKeys` and the sweep harmless.
- **Prune:** `storage_events where at < :now - 40 d`; `storage_deletions where state = 'done' and done_at < :now - 30 d`; `storage_sweeps where id <= (select max(id) from storage_sweeps) - 60`.
- **Record:** insert the `storage_sweeps` row.

No interactive transaction is needed: each statement is atomic and idempotent.

---

## 7. Indexes and plans (volume copy, `ANALYZE`d)

| Query (screen) | Index | Plan |
|---|---|---|
| One current take per slot; current take lookups (roster, detail, joins) | `recordings_current_idx` unique partial | `SEARCH r USING INDEX recordings_current_idx (assignment_id=? AND user_id=?)` |
| 5-upload count (D7) | `recordings_slot_idx` | `SEARCH … USING COVERING INDEX recordings_slot_idx (assignment_id=? AND user_id=?)` |
| Assistant `Dinlenecek`, conductor waiting part 1, badge part 1, gauge | `recordings_live_idx` partial (`audio_deleted_at is null`) | `SCAN r USING INDEX recordings_live_idx` (≤ ~500 live rows ever, by design of the quota) |
| Sweep expiry | `recordings_live_idx` | `SEARCH recordings USING INDEX recordings_live_idx (delete_on<?)` |
| Early clean | `recordings_commented_idx` partial | `SEARCH … (commented_at>? AND commented_at<?)` |
| Playback authorization | PKs, `listening_assistants_part_idx` | `SEARCH r … (id=?)`, `SEARCH la USING COVERING INDEX listening_assistants_part_idx (voice_part=? AND user_id=?)` |
| Transparency names | `listening_assistants_part_idx` | `SEARCH la USING COVERING INDEX … (voice_part=?)` |
| Effective scope | PK | `SEARCH la USING COVERING INDEX sqlite_autoindex_listening_assistants_1 (user_id=?)` |
| Notes per slot (conductor page, counts, `exists`) | PK prefix | `SEARCH n USING COVERING INDEX sqlite_autoindex_assistant_notes_1 (assignment_id=? AND singer_id=?)` |
| `Not yazdıklarım` | `assistant_notes_assistant_idx` | `SEARCH n USING INDEX assistant_notes_assistant_idx (assistant_id=?)` |
| Conductor waiting part 2, badge part 2, `Yorumlananlar` | existing `assignments_due_idx` + submissions PK | `SEARCH asg USING INDEX assignments_due_idx (due_at>?)` |
| Gauge counters | `storage_events_kind_at_idx` (kind, at, bytes) | `SEARCH … USING COVERING INDEX … (kind=? AND at>?)` |
| Drain | `storage_deletions_pending_idx` partial | `SCAN … USING INDEX storage_deletions_pending_idx` |
| Prune done rows | `storage_deletions_done_idx` partial | range on `done_at` |
| Piece MIDI list | `midi_files_piece_idx` | `SEARCH … (piece_id=?)` |
| FK child probes when a user/recording is deleted (e2e) | `recordings_user_idx`, `assistant_notes_singer_idx`, `assistant_notes_recording_idx`, `recordings_replaces_idx` | one index probe instead of a scan |

Timings (warm, local file): assistant queue 0.7 ms, conductor waiting 1.1 ms, badge 0.4 ms, gauge 0.2 ms, everything else ≤ 0.2 ms. AC 58 (< 1 s with 200 takes and 400 notes) has three orders of magnitude to spare; on Turso each is one round trip.

**No new index on an existing table.** `submissions_user_idx (user_id, assignment_id)` already serves every `(assignment, user)` join from the recording side.

---

## 8. Constraint tests (AC 56)

Run on the migrated copy, `foreign_keys = on`: 97 cases, 0 surprises. **The e2e should pick a few rejects** (marked ★).

**Accepted:** an upload with hold → release → insert; a WAV of exactly 4 194 304 B without duration on another slot; replace (old take queued) then the replacement with `replaces_id`; comment anchor set and cleared; a note on the old take, then the upsert moving it to the current take; a 1000-character note; MIDI Tutti, Alto with label, 1 048 576 B with a 60-char label; deleting a MIDI row (queued); queue rows: an orphan, a failed attempt with a kind, a done row; events, sweeps; the sweep expiry (queued); deleting a homework with live + replaced takes and notes (1 key queued, 0 rows left, no FK error); deleting a piece with 3 MIDI files (3 queued).

**Rejected:**
- recordings: ★ a second current take for the same slot; ★ size 0, 4 194 305, 12.5; ★ an unknown type; a key whose extension doesn't match the type; a key with a name in it; an upper-case key; a `midi/` key; `….m4a.html`; a non-uuid id; duration 600 001 or −1; a replaced take with audio; a replaced and commented take; deleted without reason; an unknown reason; `delete_on` `2027-02-30`, `soon`, or before the upload; replaces itself or an unknown take; an unknown user or homework (FK); `commented_at` before the upload; a reused storage key; a second replacement of the same take; ★ un-deleting audio (trigger); changing the key (trigger); replacing a commented take
- notes: ★ a second note by the same assistant on a slot; ★ a note on one's own take; blank; 1001 characters; an unknown take or assistant (FK); deleting a take a note points at
- scopes: a duplicate; ★ part `mezzo`; an unknown user (FK)
- MIDI: label 61 or blank; ★ 1 048 577 B; 0 B; `.midi`; a key without uuid; part `mezzo` or `tutti`; an unknown creator or piece (FK)
- queue: a duplicate key; ★ `recordings/../../arkhe.db`; area/prefix mismatch; `.exe`; `done` without `done_at`; attempts without time; an error without an attempt; a free-text error with a URL; a hold on a done row; size 0
- events: bytes 0; kind `list`. sweeps: a negative count; reason `manual`
- users: ★ deleting a singer who has takes, or an assistant who has a scope (restrict)

---

## 9. Migration `0010_phase9_media`

- **Order:** after 0008 (Phase 8) and 0009 (8b) are in the repo, add §2.1 to `schema.ts`, run `npm run db:generate -- --name phase9_media` → `drizzle/0010_phase9_media.sql`, `meta/0010_snapshot.json`, journal idx 10. **Regenerate in the repo; don't copy my scratch SQL** (the diff must come from the real 0009 snapshot).
- **One hand edit:** append §3 at the end of the SQL file.
- **Content:** 7 `CREATE TABLE`, 12 `CREATE INDEX`, 4 `CREATE UNIQUE INDEX`, 4 `CREATE TRIGGER`, all on new tables. Grep `ALTER|DROP|__new_` → 0. @po AC 55 wording: "only creates tables, indexes and triggers on the new tables".
- **Existing data:** nothing migrates and nothing is backfilled. Phase 4 submissions simply have no take (`Portalda kayıt yok` within the §5.7 window). Board-written feedback stays as it is (D3).
- **Live-data safety:** pure expand; Phase 8b code never reads the new tables. Deploy order as before: `npm run db:migrate` (backup → migrate → `db:check`, expecting 11/11), then the code; only after Phase 7 is live.
- **AC 55 script:** migrate a copy of a Phase 8b DB, `db:check`, grep the file (what I did).

---

## 10. Backup, restore and `db:check`

**Dump: no change to `dump.ts`.** All seven tables are in `db:backup` and the monthly encrypted email; the four triggers are emitted after the data (index → view → trigger), so they don't fire during the load. Verified: 40 tables restored, 6 triggers, `foreign_key_check` empty, a duplicate storage key still rejected, the trigger fires on the restored copy.
- **What the dump holds:** assistant notes (private text), recording metadata, scopes, MIDI metadata, queue and counters. **Not audio, not MIDI files** (D22). The dump already holds every `feedback` text, and its audience (backup recipients with the passphrase) is the board/conductor, so this doesn't widen anything; but @po, the README sentence should say the backup contains the assistants' notes (KVKK honesty).
- **Restore consequences** (D22 makes them expected, the app must handle them):
  1. A restored row with `audio_deleted_at is null` whose file isn't in the store (restored into a fresh store, or the file was deleted after the backup). The route's `get` returns `null` → **mark it**: `update recordings set audio_deleted_at = :now, deleted_reason = 'missing' where id = ? and audio_deleted_at is null` and answer 410. The trigger queues the (absent) key; its delete is a free no-op. Backend §5.1 step 10 currently answers 503 for this; please switch to "mark + 410", because a 503 would repeat for ever.
  2. Files uploaded after the backup are orphans in the store (the restored DB doesn't know them). The gauge undercounts them. A reconcile needs a Blob `list` (advanced operations), so it's not in this phase: README line "after a production restore, compare the Blob dashboard once". Locally, §12's reconcile handles it.
  3. Queue rows in the dump that were already done are harmless; pending ones are deleted on the next sweep (deleting an absent object is a no-op).
- `sqlite_sequence` isn't dumped: `storage_events`/`storage_sweeps` ids restart at max + 1. Nothing references them.

**`scripts/db-check.ts`: add, when `recordings` exists** (like the 0008 trigger check):
```sql
-- 1. the four triggers
select count(*) from sqlite_master where type = 'trigger' and name in
  ('recordings_queue_on_audio_delete', 'recordings_queue_on_delete', 'recordings_audio_final', 'midi_files_queue_on_delete');   -- must be 4
-- 2. a current take always has a submitted submission
select count(*) from recordings r left join submissions s on s.assignment_id = r.assignment_id and s.user_id = r.user_id
where r.replaced_at is null and s.submitted_at is null;                                                                      -- 0
-- 3. a deletion date from a comment always has the comment
select count(*) from recordings r left join submissions s on s.assignment_id = r.assignment_id and s.user_id = r.user_id
where r.commented_at is not null and s.feedback is null;                                                                     -- 0
-- 4. no live key is also queued
select count(*) from storage_deletions d where d.state = 'pending' and (
  exists (select 1 from recordings r where r.storage_key = d.storage_key and r.audio_deleted_at is null)
  or exists (select 1 from midi_files m where m.storage_key = d.storage_key));                                              -- 0
```
All four are 0/4 on my seed and volume copies. `problems.push("recording triggers missing")`, `"current recordings without a submission"`, `"commented recordings without a comment"`, `"live storage keys queued for deletion"`.

**8b interplay (@backend):** 8b's former-member undo refuses when "any row references the user". Add `recordings.user_id`, `assistant_notes.singer_id/assistant_id`, `listening_assistants.user_id/created_by`, `midi_files.created_by` to that list, or the undo fails with a raw FK error. (Former members are inactive and can't create these rows, so it's theoretical, but the list should be complete.)

---

## 11. Seed (D26): `scripts/media-fixture.mjs`

**`seedMedia(client, T)`**, same guard as the other fixtures (`assertFixtureTarget`), raw SQL in one `client.batch(…, "write")`, then the files.

1. **`asistan@arkhe.local`**, "Demo Asistan", `member`, `tenor`, the demo password hash, upserted like `yeni@` with **`joined_at = T − 1 h`**, `is_active = 1`, `left_at = null`, `role = 'member'`, `voice_part = 'tenor'` (so AC 20's role/part changes are undone by every cleanup). Joined after every seeded homework and rehearsal, so he is expected nowhere.
   - **He is a new active member, and some fixtures count those.** Treat him exactly like `yeni@` where it is special-cased: `scripts/seed.ts:260` (`seedCalendar`'s `choir` filter) and `scripts/finance-fixture.mjs:209` (the P1/P2 dues roster). @tech lead: grep the Phase 1–8 e2e for hard-coded member totals (the Üyeler count, roll-call totals of upcoming rehearsals) before running; `yeni@` shows the existing ones tolerate a late joiner, but I can't prove every number from here.
2. **Scope:** `delete from listening_assistants` (all rows), then asistan@ × (`soprano`, `alto`), `created_by` = sef@.
3. **One fixture change:** E · `ayse.ozturk@` gets a conductor comment: `feedback = 'Güzel; 8. ölçüde nefesi bölme.'`, `feedback_by = sef@`, `feedback_at = due(E) + 1 d` (same time as korist@'s E note). @po: D26 asks for "one recording with a conductor comment, deletion date in the future" on existing submissions; the only fixture row with a comment and a submission is korist@'s E, which D26 wants with deleted audio. So one existing row gains feedback. It is Ayşe (no login), on a past homework; I found no Phase 4 check that reads it (the AC 10 marker grep uses its own markers; `phase4-homework.mjs:35` compares a before/after snapshot, not fixed values).
4. **Recordings** (ids `00000000-0000-4000-9000-00000000000n`, keys `recordings/00000000-0000-4000-9001-00000000000n.wav`, `audio/wav`, 3 s 8 kHz 16-bit mono = **48 044 B**, `duration_ms = 3000`, `uploaded_at` = the submission's `submitted_at`, `delete_on` per §2.2):

   | n | Homework · singer (part) | State |
   |---|---|---|
   | 1 | D · Ayşe Öztürk (alto) | live, **asistan@ note** `Girişte tempo kaçıyor, 12. ölçüde nefes erken.` (T − 2 h), no comment |
   | 2 | D · Melis Aydın (alto) | live, no note |
   | 3 | D · Nazlı Koç (alto) | live, no note, **late** (`Geç`) |
   | 4 | D · Emre Aksoy (tenor) | live, out of asistan@'s scope |
   | 5 | D · Defne Arslan (soprano) | live, no note |
   | 6 | E · Ayşe Öztürk (alto) | live, `commented_at` = her comment, `delete_on` = +90 d (future) |
   | 7 | E · korist@ (alto) | `commented_at` = the existing note, **audio deleted** T − 1 d, `deleted_reason = 'conductor'`; no file |

   - Why `conductor` and not `retention` for 7 (backend §15 q10): a `retention` delete before the `delete_on` the row itself states would be inconsistent data, and the page would show both "silindi" and a future "silinecek" date. AC 38 arranges a real expiry anyway. The singer's copy is the same (`Ses dosyası silindi (<tarih>). Yorumlar duruyor.`).
   - None of these change a submission, so every Phase 1–8 count, badge and matrix stays (except item 3's one comment).
5. **MIDI** on `Ave Verum Corpus`: `delete from midi_files where piece_id = <Ave Verum>` (queued by the trigger; files reconciled), then `00000000-0000-4000-9100-000000000001` Tutti (four tracks `Soprano`, `Alto`, `Tenor`, `Bas`) and `…-000000000002` Alto, label null (`MIDI · Alto`), keys `midi/00000000-0000-4000-9101-00000000000n.mid`, sizes = the generated bytes, `created_by` = sef@.
6. **Files:** write the 6 WAVs and 2 MIDIs through the same path rule as the local driver (§12.3), `wx` + rename like the driver. The fixture does not go through the queue.

**Expected counts on a fresh seed** (verified with the §5 queries; put this table in the fixture's header comment like `homework-fixture.mjs` does):

| Who | View | Count |
|---|---|---|
| asistan@ | `Dinlenecek` (= home card `Dinleme kuyruğun: 3 kayıt`, `Dinleme (3)`) | **3** (Melis, Nazlı `Geç`, Defne) |
| asistan@ | `Not yazdıklarım` | **1** (D · Ayşe) |
| sef@ | `Yorum bekleyen` | **17** = 5 live takes (D · Ayşe, Melis, Nazlı, Emre, Defne) + 12 without a take (A · yk; B · Elif; D · Burak, Can, Elif, Kaan, Mert, Ozan, yk, Zeynep; E · yk; F · Can) |
| sef@ | `Asistan notu olanlar` = `data-review-badge` | **1** |
| sef@ | `Yorumlananlar` | **2** (E · Ayşe, E · korist@ with deleted audio) |
| sef@ | home card `Dinleme` | `17 kayıt yorum bekliyor · 1 asistan notlu` |
| korist@ (alto) | transparency names | `Demo Asistan` |
| a tenor (e.g. emre.aksoy@) | transparency | none → `Kaydını yalnızca şef dinler.` |
| `/odevler/depolama` | `Depolama` | 6 × 48 044 + the two MIDI sizes (≈ 0.03 %); `Yükleme`/`Okuma`/`Aktarım` 0 (no seeded events) |

The 17 assume the §5.7 30-day window (D due T − 2.5 d, E due T − 10 d are inside). Without the window it is the same 17 today, but grows with every real homework.

**Call site:** at the end of `seedHomework` (so `seed.ts`, `cleanup()` and `phase4-homework.mjs:333` all leave a consistent fixture), or right after each call as `ui.md` §9.2 proposes. Either order is verified; inside `seedHomework` is one entry point fewer to forget. `seedHomework`'s existing `delete from assignments where id like …` cascades the previous seed's takes and notes (trigger-queued; the reconcile removes the files).

---

## 12. e2e cleanup and `data/uploads/`

### 12.1 `cleanup()` order (`e2e/lib.mjs`), verified on a copy with e2e assistants, notes in both directions, e2e takes and MIDI

```sql
-- (existing) seedFinance, login_attempts, backup_runs, … , E2E rehearsals/terms, 8b import wipes
-- (existing) E2E homework: submissions → assignment_parts → assignments
--            ⇒ recordings and assistant_notes cascade; the trigger queues live keys
-- (existing) piece_links, pieces like 'E2E%'  ⇒ midi_files cascade, queued
-- NEW clearMedia(db), before the @e2e.test user deletes (only what points at those users):
delete from assistant_notes where assistant_id in (select id from users where email like '%@e2e.test')
                               or singer_id   in (select id from users where email like '%@e2e.test');
delete from recordings where user_id in (select id from users where email like '%@e2e.test');     -- queued
delete from listening_assistants where user_id    in (select id from users where email like '%@e2e.test')
                                    or created_by in (select id from users where email like '%@e2e.test');
delete from midi_files where created_by in (select id from users where email like '%@e2e.test'); -- queued
-- (existing) attendance, submissions, users of '%@e2e.test'
-- (existing) seedHomework(db, now)  → ends with seedMedia(db, now) (§11)
-- NEW, last:
delete from storage_deletions;
delete from storage_events;
delete from storage_sweeps;
-- then reconcileLocalUploads(db): §12.2
```
- Notes **before** recordings (no-action FK); everything that references a user **before** the user (restrict). I ran both wrong orders: each fails with `FOREIGN KEY constraint failed`.
- With cascade + triggers there is **no** need to clear media before `seedFinance`/`seedHomework` (`ui.md` §9.2 step 1): nothing in the new tables references finance rows, and the homework cascade is the clearing. `clearMedia` is only the four user-bound deletes.
- Wiping the three bookkeeping tables at the end is safe locally because the reconcile (next) is the real source of truth for files. Every Phase 9 test that arranges gauge or sweep state does it after `cleanup()`.
- **Rules for the tests:** arranged assistants and singers use `@e2e.test`; MIDI is uploaded to `E2E%` pieces, or to Ave Verum Corpus only if the test accepts that `seedMedia` resets its MIDI list; arranged takes on the A–F fixture homework go with the next `seedHomework`.
- **Dev DB caveat** (as in 8 and 8b): every e2e run resets assistants, the queue, the counters, Ave Verum's MIDI and any takes on A–F. Production is unaffected. @tech lead: one README line.

### 12.2 `reconcileLocalUploads(db)`
- List `<root>/recordings/` and `<root>/midi/` (never anything else; skip names that don't match the key pattern of §2.1, and `*.tmp-*`).
- Keep exactly: `select storage_key from recordings where audio_deleted_at is null union all select storage_key from midi_files`.
- Delete every other file. This also removes leftovers from a crashed run and anything a test wrote directly.
- AC 1's listing runs after it: `recordings/` holds exactly the 6 seeded WAVs, `midi/` the 2 seeded MIDIs.

### 12.3 One uploads root per database
- `data/arkhe.db` → `data/uploads/` (AC 1); any other file DB `data/<name>.db` → `data/uploads-<name>/` (so `e2e:prod`'s `data/e2e-prod.db` → `data/uploads-e2e-prod/`, matching backend §17).
- This matters for correctness, not tidiness: the reconcile deletes every file its DB doesn't reference. With a shared directory, `e2e:prod`'s cleanup would delete the dev DB's files.
- `npm run db:reset`: remove `data/uploads/recordings/` and `data/uploads/midi/` (the DB is new, nothing can be live), then seed. Never anything else under `data/`.
- Put the rule in one pure module without `@/` imports (like `dump.ts`), so `scripts/`, `e2e/` and the driver share it.

---

## 13. Replies

**@po:**
1. **(Decision needed) `Portalda kayıt yok` window:** I propose submissions without a live take show in `Yorum bekleyen` only for homework **due in the last 30 days** (§5.7). Otherwise every historical Phase 4 submission floods the conductor's default chip on day one. Takes with live audio are always listed (they expire anyway).
2. **`Sil` with a manager's mark:** the take is withdrawn but a `method = 'manual'` submission **stays** (the mark existed before the take). AC 12 describes the normal `self` case and still holds.
3. **Manager unmark with a take:** refused while the audio exists (backend's copy); allowed when the audio is already gone, and the take then leaves the slot (`replaced_at`), so a later upload starts clean.
4. **5 uploads count withdrawn takes too** (D7 "counting replacements" read as "counting uploads"); backend and I agree. @ux has the `<n>/5` hint.
5. **Seed:** one existing fixture row (E · Ayşe) gains a conductor comment; korist@'s E audio is deleted with reason `conductor`, not `retention` (§11). asistan@ must be special-cased like `yeni@` in two fixture filters.
6. **AC 55 wording:** "creates only tables, indexes and triggers on the new tables" (4 triggers, all on `recordings`/`midi_files`).
7. **AC 56:** every item is backed (§8). "Note text 1–1000 after trim" and "one note per (recording slot, assistant)" are the PK and a CHECK. "Scope parts from the enum" is a CHECK on one row per part. "Cascade from assignments/pieces only where the queue still receives the key": yes, by trigger, verified.
8. **D22/KVKK:** the encrypted backup contains assistant notes (and, as today, every feedback text). Say so in the README next to "audio isn't included".
9. **D17:** "90 days after the comment" is computed as an Istanbul day and stored on the take (`delete_on`); if the policy changes to 60 days later, only new dates change, existing promises stay as shown. No migration needed.

**@backend:**
- Your §15 mapped: `recordings` as you listed, with `replaced_at`, `content_type`, `duration_ms`, `deleted_reason` (`withdrawn`, `retention` included, plus `missing`), plus `replaces_id` and **`delete_on`** instead of computing cut-offs per query (same Istanbul-day semantics as your §8.2; the sweep becomes `delete_on <= :today`). `assistant_notes` PK as you asked, recording FK no action (doesn't cascade). `listening_assistants` one row per part instead of `all_parts` + child (§2.2): your `covers()` becomes `parts.includes(part)`. `midi_files.voice_part` null = Tutti. `storage_deletions` PK `storage_key`, `requested_at`, plus `state` (AC 56) and `not_before`. `storage_events`, `storage_sweeps` as you listed.
- Triggers: yes, verified with cascades. **Plain INSERT, not `insert or ignore`** (§3).
- §15 q9 (`uploading` state): replaced by the hold row (§4.1). Your §8.3 step 2 disappears; the drain's `not_before` filter does it.
- Upload transaction order (§4.1 step 4): supersede the old take **before** inserting the new one, and delete the hold in the same tx (assert 1 row).
- `saveFeedback` must set/clear `commented_at` and `delete_on` in the same `writeTx` as the feedback write (db:check invariant 3).
- `setSubmissionFor(false)`: §4.2 (refuse with audio; with audio gone also set `replaced_at` and clear `commented_at`).
- §5.1 step 10, `get` → `null`: mark `missing` + 410 (§10), not 503.
- The playback query of §5.2 is the authorization; keep it the only `storage_key` reader, in its own `server-only` module.
- Retention prune intervals: I kept yours (events 40 d, done rows 30 d, sweeps 60 rows).
- 8b undo reference list: add the new user FKs (§10).
- `db:check` additions: §10.

**@ui:**
- §9.2: cascade + trigger it is. `clearMedia` = the four user-bound deletes of §12.1, placed right before the `@e2e.test` user deletes; `seedMedia` after `seedHomework` (I suggest inside it); the bookkeeping wipe and `reconcileLocalUploads` last. Seed counts: §11.
- AC 7's row check: `content_type` (not `mime`) starts `audio/mp4` or `audio/webm`; the key is `recordings/<uuid>.(m4a|webm)` where the uuid is **not** the recording id.
- AC 56 rejects to pick: the ★ items of §8.
- Uploads root for `e2e:prod`: `data/uploads-e2e-prod/` (§12.3).

**@ux:** no schema impact from your file. The data supports `Değiştirildi · <tarih>` (`replaces_id`), `Önceki kayda yazıldı`/`Yeni kayıt` (`recording_id` vs the current take), `<n>/5` (slot count) and `Bu kayıt <tarih> tarihinde silinecek.` (`delete_on`).
