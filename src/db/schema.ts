import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
  ACCOUNTS,
  CATEGORIES,
  DUES_RATES,
  ENTRY_KINDS,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  OVERRIDE_KINDS,
} from "../lib/finance/categories";
import { TICKET_EVENT_KINDS, TICKET_STATUSES, TICKET_URGENCIES } from "../lib/board/labels";
import {
  MIDI_MAX_BYTES,
  RECORDING_EXTENSIONS,
  RECORDING_MAX_BYTES,
  RECORDING_TYPES,
} from "../lib/storage/limits";

export {
  TICKET_EVENT_KINDS,
  TICKET_STATUSES,
  TICKET_URGENCIES,
  type TicketEventKind,
  type TicketStatus,
  type TicketUrgency,
} from "../lib/board/labels";
export {
  MIDI_MAX_BYTES,
  RECORDING_EXTENSIONS,
  RECORDING_MAX_BYTES,
  RECORDING_TYPES,
  type RecordingType,
} from "../lib/storage/limits";

export const ROLES = ["conductor", "board", "member"] as const;
export const VOICE_PARTS = ["soprano", "alto", "tenor", "bass"] as const;
export const REHEARSAL_TYPES = ["tutti", "sectional", "dress", "concert"] as const;
export const ATTENDANCE_STATUSES = ["present", "late", "excused", "absent"] as const;
// self = member's advance excuse, auto = filled in as absent when attendance is closed.
export const CHECK_IN_METHODS = ["qr", "code", "manual", "self", "auto"] as const;
export const PIECE_STATUSES = ["learning", "concert", "archive"] as const;
export const LINK_KINDS = ["score", "part", "recording", "video", "other"] as const;
export const SUBMISSION_METHODS = ["self", "manual"] as const;
export const SETTING_KEYS = ["recording_email", "dues_payment_info", "backup_recipients"] as const;
export const BACKUP_TRIGGERS = ["cron", "manual"] as const;
export const BACKUP_STATUSES = ["running", "sent", "failed"] as const;
export const TOKEN_PURPOSES = ["invite", "reset"] as const;

export type Role = (typeof ROLES)[number];
export type VoicePart = (typeof VOICE_PARTS)[number];
export type RehearsalType = (typeof REHEARSAL_TYPES)[number];
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];
export type CheckInMethod = (typeof CHECK_IN_METHODS)[number];
export type PieceStatus = (typeof PIECE_STATUSES)[number];
export type LinkKind = (typeof LINK_KINDS)[number];
export type SubmissionMethod = (typeof SUBMISSION_METHODS)[number];
export type SettingKey = (typeof SETTING_KEYS)[number];
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

/** `'a', 'b'` for CHECK constraints; only ever fed our own constants. */
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));
const now = sql`(unixepoch())`;

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => integer("created_at", { mode: "timestamp" }).notNull().default(now);

const DAY_GLOB = "glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'";
const day = (column: string) => sql.raw(`${column} ${DAY_GLOB}`);
// typeof() guard: INTEGER affinity would otherwise store 12.5 as REAL.
const kurus = (column: string) =>
  sql.raw(`typeof(${column}) = 'integer' and ${column} between 1 and 1000000000`);
const optText = (column: string, max: number) =>
  sql.raw(`${column} is null or length(trim(${column})) between 1 and ${max}`);

export const users = sqliteTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone"),
    role: text("role", { enum: ROLES }).notNull().default("member"),
    voicePart: text("voice_part", { enum: VOICE_PARTS }),
    // Null until the member accepts their invite and sets a password.
    passwordHash: text("password_hash"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    // Membership period; decides who is expected at past rehearsals.
    joinedAt: integer("joined_at", { mode: "timestamp" }).notNull().default(now),
    leftAt: integer("left_at", { mode: "timestamp" }),
    lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  () => [
    check("users_role_check", sql`role in (${inList(ROLES)})`),
    check(
      "users_voice_part_check",
      sql`voice_part is null or voice_part in (${inList(VOICE_PARTS)})`,
    ),
    check("users_email_lower_check", sql`email = lower(email)`),
    check("users_left_matches_active", sql`(is_active = 1) = (left_at is null)`),
    check("users_left_after_joined", sql`left_at is null or left_at >= joined_at`),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    // SHA-256 of the cookie token; the raw token never touches the DB.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

// Single-use links for setting a password: first-time invites and password resets.
export const invites = sqliteTable(
  "invites",
  {
    tokenHash: text("token_hash").primaryKey(),
    purpose: text("purpose", { enum: TOKEN_PURPOSES }).notNull().default("invite"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("invites_user_idx").on(t.userId),
    check("invites_purpose_check", sql`purpose in (${inList(TOKEN_PURPOSES)})`),
  ],
);

export const loginAttempts = sqliteTable(
  "login_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Generic throttle log: "<email>|<ip>", "email:…", "ip:…", "checkin:<rehearsal>:<user>"…
    key: text("key").notNull(),
    attemptedAt: integer("attempted_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [index("login_attempts_key_idx").on(t.key, t.attemptedAt)],
);

export const terms = sqliteTable(
  "terms",
  {
    id: id(),
    name: text("name").notNull().unique(),
    // Plain Europe/Istanbul calendar days, inclusive.
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("terms_dates_order", sql`ends_on >= starts_on`),
    check(
      "terms_dates_format",
      sql`starts_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and ends_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'`,
    ),
    check("terms_name_length", sql`length(name) between 1 and 40`),
    index("terms_starts_idx").on(t.startsOn),
  ],
);

export const rehearsals = sqliteTable(
  "rehearsals",
  {
    id: id(),
    type: text("type", { enum: REHEARSAL_TYPES }).notNull().default("tutti"),
    // Null means the UI derives a title from the type and parts.
    title: text("title"),
    location: text("location"),
    note: text("note"),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    // Shared by all occurrences created together by "Her hafta tekrarla".
    seriesId: text("series_id"),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    openedAt: integer("opened_at", { mode: "timestamp" }),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("rehearsals_type_check", sql`type in (${inList(REHEARSAL_TYPES)})`),
    check("rehearsals_time_order", sql`ends_at > starts_at`),
    check(
      "rehearsals_closed_after_open",
      sql`closed_at is null or (opened_at is not null and closed_at >= opened_at)`,
    ),
    check("rehearsals_cancelled_not_open", sql`cancelled_at is null or opened_at is null`),
    check("rehearsals_title_length", sql`title is null or length(title) <= 80`),
    check("rehearsals_note_length", sql`note is null or length(note) <= 500`),
    index("rehearsals_starts_idx").on(t.startsAt),
    index("rehearsals_series_idx").on(t.seriesId, t.startsAt),
    // Auto-close only ever looks at rehearsals left open.
    index("rehearsals_open_idx")
      .on(t.startsAt)
      .where(sql`opened_at is not null and closed_at is null`),
  ],
);

// Kept apart from rehearsals so a careless select can never ship the secret to a member.
export const rehearsalSecrets = sqliteTable("rehearsal_secrets", {
  rehearsalId: text("rehearsal_id")
    .primaryKey()
    .references(() => rehearsals.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  rotatedAt: integer("rotated_at", { mode: "timestamp" }).notNull().default(now),
});

// Target parts of a sectional; other rehearsal types have no rows and mean everyone.
export const rehearsalParts = sqliteTable(
  "rehearsal_parts",
  {
    rehearsalId: text("rehearsal_id")
      .notNull()
      .references(() => rehearsals.id, { onDelete: "cascade" }),
    voicePart: text("voice_part", { enum: VOICE_PARTS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.rehearsalId, t.voicePart] }),
    check("rehearsal_parts_voice_check", sql`voice_part in (${inList(VOICE_PARTS)})`),
  ],
);

export const attendance = sqliteTable(
  "attendance",
  {
    rehearsalId: text("rehearsal_id")
      .notNull()
      .references(() => rehearsals.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ATTENDANCE_STATUSES }).notNull(),
    method: text("method", { enum: CHECK_IN_METHODS }).notNull(),
    // Excuse reason; only the member and managers may read it.
    note: text("note"),
    recordedAt: integer("recorded_at", { mode: "timestamp" }).notNull().default(now),
    recordedBy: text("recorded_by").references(() => users.id, { onDelete: "set null" }),
    // Set when a manager changes the row after attendance was closed ("Düzeltildi").
    correctedAt: integer("corrected_at", { mode: "timestamp" }),
  },
  (t) => [
    primaryKey({ columns: [t.rehearsalId, t.userId] }),
    index("attendance_user_idx").on(t.userId, t.rehearsalId),
    check("attendance_status_check", sql`status in (${inList(ATTENDANCE_STATUSES)})`),
    check("attendance_method_check", sql`method in (${inList(CHECK_IN_METHODS)})`),
    check("attendance_self_is_excuse", sql`method <> 'self' or status = 'excused'`),
    check("attendance_auto_is_absent", sql`method <> 'auto' or status = 'absent'`),
    check(
      "attendance_checkin_attended",
      sql`method not in ('qr', 'code') or status in ('present', 'late')`,
    ),
    check("attendance_note_length", sql`note is null or length(note) <= 200`),
  ],
);

export const pieces = sqliteTable(
  "pieces",
  {
    id: id(),
    title: text("title").notNull(),
    composer: text("composer"),
    arranger: text("arranger"),
    language: text("language"),
    voicing: text("voicing"),
    durationSec: integer("duration_sec"),
    status: text("status", { enum: PIECE_STATUSES }).notNull().default("learning"),
    notes: text("notes"),
    driveFolderUrl: text("drive_folder_url"),
    // Current concert programme order; null = not in the programme.
    programPosition: integer("program_position"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(now)
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    check("pieces_status_check", sql`status in (${inList(PIECE_STATUSES)})`),
    check("pieces_title_length", sql`length(trim(title)) between 1 and 120`),
    check("pieces_composer_length", sql`composer is null or length(composer) between 1 and 120`),
    check("pieces_arranger_length", sql`arranger is null or length(arranger) between 1 and 120`),
    check("pieces_language_length", sql`language is null or length(language) between 1 and 40`),
    check("pieces_voicing_length", sql`voicing is null or length(voicing) between 1 and 20`),
    check("pieces_duration_range", sql`duration_sec is null or duration_sec between 1 and 5999`),
    check("pieces_notes_length", sql`notes is null or length(notes) between 1 and 1000`),
    check(
      "pieces_folder_url_check",
      sql`drive_folder_url is null or (substr(drive_folder_url, 1, 8) = 'https://' and length(drive_folder_url) <= 2000)`,
    ),
    check("pieces_program_position_check", sql`program_position is null or program_position >= 1`),
    check("pieces_archive_not_in_program", sql`status <> 'archive' or program_position is null`),
    index("pieces_status_idx").on(t.status),
    uniqueIndex("pieces_program_position_unique")
      .on(t.programPosition)
      .where(sql`program_position is not null`),
  ],
);

export const pieceLinks = sqliteTable(
  "piece_links",
  {
    id: id(),
    pieceId: text("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LINK_KINDS }).notNull(),
    // Null means Tutti (whole choir); divisi lives in the label.
    voicePart: text("voice_part", { enum: VOICE_PARTS }),
    // Null means the UI derives "<Kind> · <Part>".
    label: text("label"),
    // Always normalised by src/lib/links.ts.
    url: text("url").notNull(),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("piece_links_kind_check", sql`kind in (${inList(LINK_KINDS)})`),
    check(
      "piece_links_voice_part_check",
      sql`voice_part is null or voice_part in (${inList(VOICE_PARTS)})`,
    ),
    check("piece_links_label_length", sql`label is null or length(trim(label)) between 1 and 120`),
    check("piece_links_url_check", sql`substr(url, 1, 8) = 'https://' and length(url) <= 2000`),
    check("piece_links_position_check", sql`position >= 1`),
    uniqueIndex("piece_links_piece_url_unique").on(t.pieceId, t.url),
    index("piece_links_piece_position_idx").on(t.pieceId, t.position),
  ],
);

export const assignments = sqliteTable(
  "assignments",
  {
    id: id(),
    pieceId: text("piece_id")
      .notNull()
      .references(() => pieces.id, { onDelete: "restrict" }),
    barFrom: integer("bar_from"),
    barTo: integer("bar_to"),
    description: text("description"),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    // Also the "given at" moment: only members who joined by then are expected.
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(now)
      .$onUpdateFn(() => new Date()),
  },
  (t) => [
    check("assignments_bars_pair", sql`(bar_from is null) = (bar_to is null)`),
    check(
      "assignments_bars_range",
      sql`bar_from is null or (bar_from between 1 and 9999 and bar_to between bar_from and 9999)`,
    ),
    check(
      "assignments_description_length",
      sql`description is null or length(trim(description)) between 1 and 1000`,
    ),
    index("assignments_due_idx").on(t.dueAt),
    index("assignments_piece_due_idx").on(t.pieceId, t.dueAt),
  ],
);

// At least one row per assignment; written in the same batch as the assignment.
export const assignmentParts = sqliteTable(
  "assignment_parts",
  {
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    voicePart: text("voice_part", { enum: VOICE_PARTS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.assignmentId, t.voicePart] }),
    index("assignment_parts_voice_idx").on(t.voicePart, t.assignmentId),
    check("assignment_parts_voice_check", sql`voice_part in (${inList(VOICE_PARTS)})`),
  ],
);

// One row per (assignment, singer): a submission, a feedback note, or both.
export const submissions = sqliteTable(
  "submissions",
  {
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    method: text("method", { enum: SUBMISSION_METHODS }),
    markedBy: text("marked_by").references(() => users.id, { onDelete: "set null" }),
    // Private: only this singer and managers may read it.
    feedback: text("feedback"),
    feedbackBy: text("feedback_by").references(() => users.id, { onDelete: "set null" }),
    feedbackAt: integer("feedback_at", { mode: "timestamp" }),
    feedbackSeenAt: integer("feedback_seen_at", { mode: "timestamp" }),
  },
  (t) => [
    primaryKey({ columns: [t.assignmentId, t.userId] }),
    index("submissions_user_idx").on(t.userId, t.assignmentId),
    check(
      "submissions_method_check",
      sql`method is null or method in (${inList(SUBMISSION_METHODS)})`,
    ),
    check("submissions_method_matches", sql`(submitted_at is null) = (method is null)`),
    check("submissions_marked_by_manual", sql`marked_by is null or method = 'manual'`),
    check("submissions_feedback_at_matches", sql`(feedback is null) = (feedback_at is null)`),
    check(
      "submissions_feedback_meta",
      sql`feedback is not null or (feedback_by is null and feedback_seen_at is null)`,
    ),
    check(
      "submissions_feedback_length",
      sql`feedback is null or length(trim(feedback)) between 1 and 1000`,
    ),
    check("submissions_not_empty", sql`submitted_at is not null or feedback is not null`),
  ],
);

export const appSettings = sqliteTable(
  "app_settings",
  {
    key: text("key", { enum: SETTING_KEYS }).primaryKey(),
    value: text("value").notNull(),
    // First save of this key; upserts never touch it.
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  () => [
    check("app_settings_key_check", sql`key in (${inList(SETTING_KEYS)})`),
    check("app_settings_value_length", sql`length(value) between 1 and 2000`),
    check("app_settings_payment_info", sql`key <> 'dues_payment_info' or length(value) <= 500`),
    check(
      "app_settings_recording_email",
      sql`key <> 'recording_email' or (value = lower(trim(value)) and length(value) <= 254 and value like '%_@_%._%')`,
    ),
    // Canonical "a@x.org,b@y.org": 1-5 addresses, one @ each, nothing that could split a header.
    // char(59) is ';': drizzle-kit cuts CHECK text at a literal semicolon.
    check(
      "app_settings_backup_recipients",
      sql`key <> 'backup_recipients' or (value = lower(value) and value not glob ('*[ <>"' || char(9, 10, 13, 59) || ']*') and length(value) <= 1274 and value like '%_@_%._%' and value not like ',%' and value not like '%,' and instr(value, ',,') = 0 and length(value) - length(replace(value, ',', '')) <= 4 and length(value) - length(replace(value, '@', '')) = length(value) - length(replace(value, ',', '')) + 1)`,
    ),
  ],
);

// One row per send attempt. A month is covered when any row for it is `sent`.
export const backupRuns = sqliteTable(
  "backup_runs",
  {
    id: id(),
    reportMonth: text("report_month").notNull(), // 'YYYY-MM', Istanbul calendar month
    trigger: text("trigger", { enum: BACKUP_TRIGGERS }).notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status", { enum: BACKUP_STATUSES }).notNull().default("running"),
    startedAt: integer("started_at", { mode: "timestamp" }).notNull().default(now),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    sizeBytes: integer("size_bytes"),
    recipientCount: integer("recipient_count").notNull(),
    error: text("error"),
  },
  (t) => [
    // At most one in-flight run per month: the claim's backstop.
    uniqueIndex("backup_runs_running_idx")
      .on(t.reportMonth)
      .where(sql`status = 'running'`),
    index("backup_runs_month_status_idx").on(t.reportMonth, t.status),
    index("backup_runs_started_idx").on(t.startedAt),
    check(
      "backup_runs_month_check",
      sql`report_month glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and substr(report_month, 6, 2) between '01' and '12'`,
    ),
    check("backup_runs_trigger_check", sql`trigger in (${inList(BACKUP_TRIGGERS)})`),
    check("backup_runs_status_check", sql`status in (${inList(BACKUP_STATUSES)})`),
    check("backup_runs_cron_actor", sql`trigger = 'manual' or actor_id is null`),
    check(
      "backup_runs_finished",
      sql`(status = 'running') = (finished_at is null) and (finished_at is null or finished_at >= started_at)`,
    ),
    check(
      "backup_runs_error",
      sql`(status = 'failed') = (error is not null) and (error is null or length(trim(error)) between 1 and 500)`,
    ),
    check(
      "backup_runs_size",
      sql`size_bytes is null or (typeof(size_bytes) = 'integer' and size_bytes between 0 and 1000000000)`,
    ),
    check(
      "backup_runs_recipients",
      sql`typeof(recipient_count) = 'integer' and recipient_count between 1 and 5`,
    ),
  ],
);

export const sponsors = sqliteTable(
  "sponsors",
  {
    id: id(),
    name: text("name").notNull(),
    // searchKey(name): SQLite lower() is ASCII-only, so "İş" and "iş" would not collide.
    nameKey: text("name_key").notNull(),
    contactName: text("contact_name"),
    contact: text("contact"),
    note: text("note"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sponsors_name_key_idx").on(t.nameKey),
    check("sponsors_name_length", sql`length(trim(name)) between 1 and 120`),
    check(
      "sponsors_texts",
      sql`(${optText("contact_name", 80)}) and (${optText("contact", 120)}) and (${optText("note", 500)})`,
    ),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: id(),
    name: text("name").notNull(),
    startsOn: text("starts_on").notNull(),
    rehearsalId: text("rehearsal_id").references(() => rehearsals.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("events_rehearsal_idx")
      .on(t.rehearsalId)
      .where(sql`rehearsal_id is not null`),
    index("events_starts_idx").on(t.startsOn),
    check("events_name_length", sql`length(trim(name)) between 1 and 80`),
    check("events_starts_format", day("starts_on")),
  ],
);

export const duesPeriods = sqliteTable(
  "dues_periods",
  {
    id: id(),
    name: text("name").notNull().unique(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    dueOn: text("due_on").notNull(),
    amountKurus: integer("amount_kurus").notNull(),
    reducedAmountKurus: integer("reduced_amount_kurus"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("dues_periods_starts_idx").on(t.startsOn),
    check("dues_periods_name_length", sql`length(trim(name)) between 1 and 40`),
    check(
      "dues_periods_dates",
      sql`${day("starts_on")} and ${day("ends_on")} and ${day("due_on")} and ends_on >= starts_on and due_on >= starts_on`,
    ),
    check("dues_periods_amount", kurus("amount_kurus")),
    check(
      "dues_periods_reduced",
      sql`reduced_amount_kurus is null or (typeof(reduced_amount_kurus) = 'integer' and reduced_amount_kurus between 1 and amount_kurus - 1)`,
    ),
  ],
);

// No row = standard rate. Kept off users so the manager-only note never rides along a users select.
export const memberDues = sqliteTable(
  "member_dues",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "restrict" }),
    rate: text("rate", { enum: DUES_RATES }).notNull(),
    note: text("note"),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
  },
  () => [
    check("member_dues_rate_check", sql`rate in (${inList(DUES_RATES)})`),
    check("member_dues_note_length", optText("note", 200)),
  ],
);

// waiver = "Bu dönem muaf" (owes 0); freeze = what was owed, pinned when the rate changed after a payment.
// created_by/created_at mean "last written by/at" (a waiver upsert refreshes both).
export const duesOverrides = sqliteTable(
  "dues_overrides",
  {
    duesPeriodId: text("dues_period_id")
      .notNull()
      .references(() => duesPeriods.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: OVERRIDE_KINDS }).notNull(),
    owedKurus: integer("owed_kurus").notNull(),
    reason: text("reason").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.duesPeriodId, t.userId] }),
    index("dues_overrides_user_idx").on(t.userId),
    check("dues_overrides_kind_check", sql`kind in (${inList(OVERRIDE_KINDS)})`),
    check(
      "dues_overrides_owed",
      sql`typeof(owed_kurus) = 'integer' and ((kind = 'waiver' and owed_kurus = 0) or (kind = 'freeze' and owed_kurus between 1 and 1000000000))`,
    ),
    check("dues_overrides_reason_length", sql`length(trim(reason)) between 3 and 200`),
  ],
);

// Money is never deleted: a wrong entry is voided (who, when, why) and every FK here is restrict.
export const financeEntries = sqliteTable(
  "finance_entries",
  {
    id: id(),
    kind: text("kind", { enum: ENTRY_KINDS }).notNull(),
    category: text("category", { enum: CATEGORIES }),
    amountKurus: integer("amount_kurus").notNull(),
    // Plain Europe/Istanbul calendar day.
    occurredOn: text("occurred_on").notNull(),
    account: text("account", { enum: ACCOUNTS }).notNull(),
    toAccount: text("to_account", { enum: ACCOUNTS }),
    description: text("description"),
    counterparty: text("counterparty"),
    documentUrl: text("document_url"),
    sponsorId: text("sponsor_id").references(() => sponsors.id, { onDelete: "restrict" }),
    eventId: text("event_id").references(() => events.id, { onDelete: "restrict" }),
    memberId: text("member_id").references(() => users.id, { onDelete: "restrict" }),
    duesPeriodId: text("dues_period_id").references(() => duesPeriods.id, {
      onDelete: "restrict",
    }),
    // Shared by the per-period rows of one multi-period dues payment.
    paymentGroupId: text("payment_group_id"),
    replacesId: text("replaces_id").references((): AnySQLiteColumn => financeEntries.id, {
      onDelete: "restrict",
    }),
    // Optimistic lock for meta edits; updated_at has only second resolution.
    revision: integer("revision").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    voidedAt: integer("voided_at", { mode: "timestamp" }),
    voidedBy: text("voided_by").references(() => users.id, { onDelete: "restrict" }),
    voidReason: text("void_reason"),
  },
  (t) => [
    check("fe_kind", sql`kind in (${inList(ENTRY_KINDS)})`),
    check(
      "fe_account",
      sql`account in (${inList(ACCOUNTS)}) and (to_account is null or to_account in (${inList(ACCOUNTS)}))`,
    ),
    check(
      "fe_transfer",
      sql`(kind = 'transfer') = (to_account is not null) and (to_account is null or to_account <> account)`,
    ),
    check("fe_category_present", sql`(kind in ('income', 'expense')) = (category is not null)`),
    check(
      "fe_category_income",
      sql`kind <> 'income' or category in (${inList(INCOME_CATEGORIES)})`,
    ),
    check(
      "fe_category_expense",
      sql`kind <> 'expense' or category in (${inList(EXPENSE_CATEGORIES)})`,
    ),
    check("fe_amount", kurus("amount_kurus")),
    check("fe_occurred_format", day("occurred_on")),
    check("fe_sponsor", sql`(category is 'sponsorship') = (sponsor_id is not null)`),
    check(
      "fe_dues",
      sql`(category is 'dues') = (member_id is not null) and (category is 'dues') = (dues_period_id is not null) and (payment_group_id is null or category is 'dues')`,
    ),
    check("fe_event", sql`event_id is null or kind in ('income', 'expense')`),
    check("fe_texts", sql`(${optText("description", 200)}) and (${optText("counterparty", 120)})`),
    check(
      "fe_document",
      sql`document_url is null or (document_url like 'https://%' and length(document_url) <= 2000)`,
    ),
    check("fe_updated_pair", sql`(updated_at is null) = (updated_by is null)`),
    check(
      "fe_void_triple",
      sql`(voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)`,
    ),
    check(
      "fe_void_reason",
      sql`void_reason is null or length(trim(void_reason)) between 5 and 200`,
    ),
    check("fe_replaces_self", sql`replaces_id is null or replaces_id <> id`),
    uniqueIndex("fe_opening_idx")
      .on(t.account)
      .where(sql`kind = 'opening' and voided_at is null`),
    uniqueIndex("fe_replaces_idx")
      .on(t.replacesId)
      .where(sql`replaces_id is not null`),
    index("fe_occurred_idx").on(t.occurredOn, t.createdAt),
    index("fe_event_idx").on(t.eventId),
    index("fe_sponsor_idx").on(t.sponsorId, t.occurredOn),
    index("fe_member_idx").on(t.memberId, t.duesPeriodId),
    index("fe_period_idx").on(t.duesPeriodId),
    index("fe_payment_group_idx")
      .on(t.paymentGroupId)
      .where(sql`payment_group_id is not null`),
  ],
);

// One row; the high-water mark keeps #numbers unique for ever, even after a delete or a restore.
export const boardTicketSeq = sqliteTable(
  "board_ticket_seq",
  {
    id: integer("id").primaryKey(),
    lastNumber: integer("last_number").notNull(),
  },
  () => [
    check("board_ticket_seq_single", sql`id = 1`),
    check("board_ticket_seq_last", sql`typeof(last_number) = 'integer' and last_number >= 0`),
  ],
);

export const boardTickets = sqliteTable(
  "board_tickets",
  {
    id: id(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", { enum: TICKET_STATUSES }).notNull().default("todo"),
    urgency: text("urgency", { enum: TICKET_URGENCIES }).notNull().default("medium"),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "restrict" }),
    // Plain Europe/Istanbul calendar day.
    dueOn: text("due_on"),
    doneAt: integer("done_at", { mode: "timestamp" }),
    // Optimistic lock for edits; bumped by every write to this row, moves included.
    revision: integer("revision").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(now),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("board_tickets_number_idx").on(t.number),
    index("board_tickets_status_idx").on(t.status, t.doneAt),
    index("board_tickets_assignee_idx").on(t.assigneeId, t.status),
    check("board_tickets_number_check", sql`typeof(number) = 'integer' and number >= 1`),
    check("board_tickets_status_check", sql`status in (${inList(TICKET_STATUSES)})`),
    check("board_tickets_urgency_check", sql`urgency in (${inList(TICKET_URGENCIES)})`),
    check(
      "board_tickets_title_length",
      sql`length(trim(title)) between 3 and 120 and length(title) <= 120`,
    ),
    check("board_tickets_description_length", optText("description", 4000)),
    check(
      "board_tickets_due_format",
      sql`due_on is null or (${day("due_on")} and date(due_on) is due_on)`,
    ),
    check("board_tickets_done_at", sql`(status = 'done') = (done_at is not null)`),
    check("board_tickets_revision_check", sql`typeof(revision) = 'integer' and revision >= 0`),
  ],
);

// The ticket's thread: system entries (who changed what) and comments, oldest first by id.
export const boardTicketEvents = sqliteTable(
  "board_ticket_events",
  {
    // AUTOINCREMENT: ids never repeat, so "seen up to id N" is exact.
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => boardTickets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TICKET_EVENT_KINDS }).notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Comment text; null for system entries.
    body: text("body"),
    // Per-mount key of the comment form, so a replayed submit can't post twice.
    clientKey: text("client_key"),
    // status/urgency codes or due days; null means "none" (— or Atanmadı).
    fromValue: text("from_value"),
    toValue: text("to_value"),
    fromUserId: text("from_user_id").references(() => users.id, { onDelete: "restrict" }),
    toUserId: text("to_user_id").references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("board_ticket_events_ticket_idx").on(t.ticketId),
    index("board_ticket_events_comments_idx")
      .on(t.ticketId)
      .where(sql`kind = 'comment'`),
    uniqueIndex("board_ticket_events_client_key_idx")
      .on(t.clientKey)
      .where(sql`client_key is not null`),
    check("board_ticket_events_kind_check", sql`kind in (${inList(TICKET_EVENT_KINDS)})`),
    check(
      "board_ticket_events_body",
      sql`(kind = 'comment') = (body is not null) and (body is null or (length(trim(body)) >= 1 and length(body) <= 2000))`,
    ),
    check("board_ticket_events_client_key", sql`client_key is null or kind = 'comment'`),
    check(
      "board_ticket_events_users",
      sql`kind = 'assignee' or (from_user_id is null and to_user_id is null)`,
    ),
    check(
      "board_ticket_events_values",
      sql`coalesce(case kind
        when 'status' then from_value in (${inList(TICKET_STATUSES)}) and to_value in (${inList(TICKET_STATUSES)}) and from_value <> to_value
        when 'urgency' then from_value in (${inList(TICKET_URGENCIES)}) and to_value in (${inList(TICKET_URGENCIES)}) and from_value <> to_value
        when 'due' then (from_value is null or date(from_value) is from_value) and (to_value is null or date(to_value) is to_value) and from_value is not to_value
        when 'assignee' then from_value is null and to_value is null and from_user_id is not to_user_id
        else from_value is null and to_value is null end, 0)`,
    ),
  ],
);

// Per manager: the last thread entry and ticket revision they saw on the detail page.
export const boardTicketReads = sqliteTable(
  "board_ticket_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => boardTickets.id, { onDelete: "cascade" }),
    seenEventId: integer("seen_event_id").notNull(),
    seenRevision: integer("seen_revision").notNull(),
    seenAt: integer("seen_at", { mode: "timestamp" }).notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ticketId] }),
    // The cascade from board_tickets looks rows up by ticket alone.
    index("board_ticket_reads_ticket_idx").on(t.ticketId),
    check(
      "board_ticket_reads_seen",
      sql`typeof(seen_event_id) = 'integer' and seen_event_id >= 0 and typeof(seen_revision) = 'integer' and seen_revision >= 0`,
    ),
  ],
);

const monthOk = (column: string) =>
  sql.raw(
    `${column} glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and strftime('%Y-%m', ${column} || '-01') is ${column}`,
  );

// Triggers in 0008 forbid overlaps; a drizzle "__new_budgets" rebuild would silently drop them.
export const budgets = sqliteTable(
  "budgets",
  {
    id: id(),
    name: text("name").notNull(),
    startMonth: text("start_month").notNull(),
    // Exclusive; always start_month + 12 months, stored so range queries stay indexable.
    endMonth: text("end_month").notNull(),
    note: text("note"),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    approvedBy: text("approved_by").references(() => users.id, { onDelete: "restrict" }),
    // Optimistic lock for plan saves.
    revision: integer("revision").notNull().default(0),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    updatedBy: text("updated_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    uniqueIndex("budgets_name_idx").on(t.name),
    uniqueIndex("budgets_start_idx").on(t.startMonth),
    check("budgets_name_length", sql`length(trim(name)) between 1 and 40 and length(name) <= 40`),
    check("budgets_start_format", monthOk("start_month")),
    check(
      "budgets_end_month",
      sql`end_month is strftime('%Y-%m', start_month || '-01', '+12 months')`,
    ),
    check("budgets_note_length", optText("note", 500)),
    check("budgets_approved_pair", sql`(approved_at is null) = (approved_by is null)`),
    check("budgets_updated_pair", sql`(updated_at is null) = (updated_by is null)`),
    check("budgets_revision_check", sql`typeof(revision) = 'integer' and revision >= 0`),
  ],
);

// One row per planned category; a missing row means 0 ("not planned").
export const budgetLines = sqliteTable(
  "budget_lines",
  {
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    category: text("category", { enum: CATEGORIES }).notNull(),
    amountKurus: integer("amount_kurus").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.category] }),
    check("budget_lines_category_check", sql`category in (${inList(CATEGORIES)})`),
    check("budget_lines_amount", kurus("amount_kurus")),
  ],
);

// One row per "Planı değiştir" save on an approved budget.
export const budgetRevisions = sqliteTable(
  "budget_revisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    budgetId: text("budget_id")
      .notNull()
      .references(() => budgets.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("budget_revisions_budget_idx").on(t.budgetId),
    check(
      "budget_revisions_reason_length",
      sql`length(trim(reason)) between 5 and 200 and length(reason) <= 200`,
    ),
  ],
);

export const budgetRevisionLines = sqliteTable(
  "budget_revision_lines",
  {
    revisionId: integer("revision_id")
      .notNull()
      .references(() => budgetRevisions.id, { onDelete: "cascade" }),
    category: text("category", { enum: CATEGORIES }).notNull(),
    fromKurus: integer("from_kurus").notNull(),
    toKurus: integer("to_kurus").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.revisionId, t.category] }),
    check("budget_revision_lines_category_check", sql`category in (${inList(CATEGORIES)})`),
    check(
      "budget_revision_lines_amounts",
      sql`typeof(from_kurus) = 'integer' and typeof(to_kurus) = 'integer' and from_kurus between 0 and 1000000000 and to_kurus between 0 and 1000000000 and from_kurus <> to_kurus`,
    ),
  ],
);

export const IMPORT_KINDS = [
  "members",
  "terms",
  "attendance",
  "entries",
  "dues_periods",
  "dues_payments",
] as const;
export const IMPORT_STATUSES = ["imported", "undone"] as const;
export const IMPORT_TARGETS = [
  "user",
  "term",
  "rehearsal",
  "finance_entry",
  "dues_period",
  "dues_override",
  "sponsor",
] as const;
export const IMPORT_ACTIONS = ["create", "update"] as const;
export const KAYIT_SCOPES = ["entries", "dues_payments"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export type ImportTarget = (typeof IMPORT_TARGETS)[number];
export type ImportAction = (typeof IMPORT_ACTIONS)[number];
export type KayitScope = (typeof KAYIT_SCOPES)[number];

// One row per committed file; never the file itself. The integer id is the commit order (undo stack).
export const importBatches = sqliteTable(
  "import_batches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: IMPORT_KINDS }).notNull(),
    status: text("status", { enum: IMPORT_STATUSES }).notNull().default("imported"),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull(),
    fileSha256: text("file_sha256").notNull(),
    rowCount: integer("row_count").notNull(),
    addedCount: integer("added_count").notNull(),
    updatedCount: integer("updated_count").notNull(),
    unchangedCount: integer("unchanged_count").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    undoneAt: integer("undone_at", { mode: "timestamp" }),
    undoneBy: text("undone_by").references(() => users.id, { onDelete: "restrict" }),
  },
  (t) => [
    index("import_batches_kind_idx").on(t.kind, t.id),
    index("import_batches_sha_idx").on(t.fileSha256),
    check("import_batches_kind_check", sql`kind in (${inList(IMPORT_KINDS)})`),
    check("import_batches_status_check", sql`status in (${inList(IMPORT_STATUSES)})`),
    check(
      "import_batches_undo",
      sql`(status = 'undone') = (undone_at is not null) and (undone_at is null) = (undone_by is null) and (undone_at is null or undone_at >= created_at)`,
    ),
    // char(47) and char(92) are / and \: no path may sneak into the logged name.
    check(
      "import_batches_file_name",
      sql`length(trim(file_name)) between 1 and 120 and length(file_name) <= 120 and file_name not glob ('*[' || char(1, 9, 10, 13, 47, 92) || ']*')`,
    ),
    check(
      "import_batches_file_size",
      sql`typeof(file_size) = 'integer' and file_size between 1 and 1048576`,
    ),
    check(
      "import_batches_sha",
      sql`length(file_sha256) = 64 and file_sha256 not glob '*[^0-9a-f]*'`,
    ),
    check(
      "import_batches_counts",
      sql`typeof(row_count) = 'integer' and typeof(added_count) = 'integer' and typeof(updated_count) = 'integer' and typeof(unchanged_count) = 'integer' and row_count between 1 and 5000 and added_count >= 0 and updated_count >= 0 and unchanged_count >= 0 and added_count + updated_count + unchanged_count = row_count and added_count + updated_count >= 1`,
    ),
  ],
);

const itemTargetColumns = {
  user: "user_id",
  term: "term_id",
  rehearsal: "rehearsal_id",
  finance_entry: "finance_entry_id",
  dues_period: "dues_period_id",
  dues_override: "override_period_id",
  sponsor: "sponsor_id",
} as const satisfies Record<ImportTarget, string>;
// Restrict FKs never go null; set-null ones go null when the row was deleted by hand since.
const neverNull = new Set<ImportTarget>(["user", "finance_entry", "sponsor"]);
const itemTargetCheck = sql.raw(
  `coalesce(case target ${IMPORT_TARGETS.map((target) => {
    const own = itemTargetColumns[target];
    const others = Object.values(itemTargetColumns)
      .filter((c) => c !== own)
      .map((c) => `${c} is null`)
      .join(" and ");
    return `when '${target}' then ${others}${neverNull.has(target) ? ` and ${own} is not null` : ""}`;
  }).join(" ")} end, 0)`,
);

// What a batch wrote: the undo list and the "İçe aktarıldı" marker. Deleted by the undo.
export const importItems = sqliteTable(
  "import_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    batchId: integer("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    target: text("target", { enum: IMPORT_TARGETS }).notNull(),
    action: text("action", { enum: IMPORT_ACTIONS }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "restrict" }),
    termId: text("term_id").references(() => terms.id, { onDelete: "set null" }),
    rehearsalId: text("rehearsal_id").references(() => rehearsals.id, { onDelete: "set null" }),
    financeEntryId: text("finance_entry_id").references(() => financeEntries.id, {
      onDelete: "restrict",
    }),
    duesPeriodId: text("dues_period_id").references(() => duesPeriods.id, {
      onDelete: "set null",
    }),
    overridePeriodId: text("override_period_id"),
    overrideUserId: text("override_user_id"),
    sponsorId: text("sponsor_id").references(() => sponsors.id, { onDelete: "restrict" }),
    kayitScope: text("kayit_scope", { enum: KAYIT_SCOPES }),
    kayitNo: text("kayit_no"),
    // User updates: the values to restore.
    beforeJson: text("before_json"),
    // The row as written; undo refuses when the live row no longer matches it.
    afterJson: text("after_json"),
  },
  (t) => [
    foreignKey({
      columns: [t.overridePeriodId, t.overrideUserId],
      foreignColumns: [duesOverrides.duesPeriodId, duesOverrides.userId],
      name: "import_items_override_fk",
    }).onDelete("set null"),
    index("import_items_batch_idx").on(t.batchId, t.target),
    uniqueIndex("import_items_kayit_idx")
      .on(t.kayitScope, t.kayitNo)
      .where(sql`kayit_no is not null`),
    index("import_items_user_idx")
      .on(t.userId)
      .where(sql`user_id is not null`),
    uniqueIndex("import_items_term_idx")
      .on(t.termId)
      .where(sql`term_id is not null`),
    uniqueIndex("import_items_rehearsal_idx")
      .on(t.rehearsalId)
      .where(sql`rehearsal_id is not null`),
    uniqueIndex("import_items_entry_idx")
      .on(t.financeEntryId)
      .where(sql`finance_entry_id is not null`),
    uniqueIndex("import_items_period_idx")
      .on(t.duesPeriodId)
      .where(sql`dues_period_id is not null`),
    uniqueIndex("import_items_override_idx")
      .on(t.overridePeriodId, t.overrideUserId)
      .where(sql`override_period_id is not null`),
    uniqueIndex("import_items_sponsor_idx")
      .on(t.sponsorId)
      .where(sql`sponsor_id is not null`),
    check("import_items_target_check", sql`target in (${inList(IMPORT_TARGETS)})`),
    check("import_items_action_check", sql`action in (${inList(IMPORT_ACTIONS)})`),
    check("import_items_one_target", itemTargetCheck),
    check(
      "import_items_override_pair",
      sql`(override_period_id is null) = (override_user_id is null)`,
    ),
    check("import_items_update_is_user", sql`action = 'create' or target = 'user'`),
    check(
      "import_items_kayit",
      sql`(kayit_no is null) = (kayit_scope is null) and (kayit_scope is null or kayit_scope in (${inList(KAYIT_SCOPES)})) and (kayit_no is null or (length(kayit_no) between 1 and 40 and kayit_no not glob '*[^A-Za-z0-9._/-]*')) and (kayit_no is null or target in ('finance_entry', 'dues_override')) and (target <> 'finance_entry' or kayit_no is not null)`,
    ),
    check(
      "import_items_json",
      sql`(action = 'update') = (before_json is not null) and (before_json is null or (json_valid(before_json) and length(before_json) <= 4000)) and (after_json is null or (json_valid(after_json) and length(after_json) <= 4000)) and (target not in ('user', 'rehearsal', 'dues_period', 'dues_override', 'sponsor') or after_json is not null)`,
    ),
  ],
);

// ------------------------------------------------- Phase 9: recordings, assistant review, MIDI files

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
// Triggers in 0010 queue files on audio delete and row delete; a drizzle "__new_recordings" rebuild would silently drop them.
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
// Triggers in 0010 queue files on audio delete and row delete; a drizzle "__new_midi_files" rebuild would silently drop them.
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
// 0011 adds `area` with a column CHECK (area is null or in STORAGE_AREAS), written by hand in the SQL.
export const storageEvents = sqliteTable(
  "storage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: STORAGE_EVENT_KINDS }).notNull(),
    /** 0011: null on older rows (read as "recording"). MIDI gets count toward transfer only. */
    area: text("area", { enum: STORAGE_AREAS }),
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
