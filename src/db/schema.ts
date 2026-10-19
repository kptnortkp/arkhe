import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
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

export const ROLES = ["conductor", "board", "member"] as const;
export const VOICE_PARTS = ["soprano", "alto", "tenor", "bass"] as const;
export const REHEARSAL_TYPES = ["tutti", "sectional", "dress", "concert"] as const;
export const ATTENDANCE_STATUSES = ["present", "late", "excused", "absent"] as const;
// self = member's advance excuse, auto = filled in as absent when attendance is closed.
export const CHECK_IN_METHODS = ["qr", "code", "manual", "self", "auto"] as const;
export const PIECE_STATUSES = ["learning", "concert", "archive"] as const;
export const LINK_KINDS = ["score", "part", "recording", "video", "other"] as const;
export const SUBMISSION_METHODS = ["self", "manual"] as const;
export const SETTING_KEYS = ["recording_email", "dues_payment_info"] as const;
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
