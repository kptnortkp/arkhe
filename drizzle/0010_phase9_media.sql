CREATE TABLE `assistant_notes` (
	`assignment_id` text NOT NULL,
	`singer_id` text NOT NULL,
	`assistant_id` text NOT NULL,
	`recording_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`assignment_id`, `singer_id`, `assistant_id`),
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`singer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`assistant_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recording_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "assistant_notes_not_own" CHECK(assistant_id <> singer_id),
	CONSTRAINT "assistant_notes_body" CHECK(length(trim(body)) between 1 and 1000 and length(body) <= 1000),
	CONSTRAINT "assistant_notes_updated" CHECK(updated_at >= created_at)
);
--> statement-breakpoint
CREATE INDEX `assistant_notes_assistant_idx` ON `assistant_notes` (`assistant_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `assistant_notes_singer_idx` ON `assistant_notes` (`singer_id`);--> statement-breakpoint
CREATE INDEX `assistant_notes_recording_idx` ON `assistant_notes` (`recording_id`);--> statement-breakpoint
CREATE TABLE `listening_assistants` (
	`user_id` text NOT NULL,
	`voice_part` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `voice_part`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "listening_assistants_voice_check" CHECK(voice_part in ('soprano', 'alto', 'tenor', 'bass'))
);
--> statement-breakpoint
CREATE INDEX `listening_assistants_part_idx` ON `listening_assistants` (`voice_part`,`user_id`);--> statement-breakpoint
CREATE TABLE `midi_files` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`voice_part` text,
	`label` text,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "midi_files_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "midi_files_voice_part_check" CHECK(voice_part is null or voice_part in ('soprano', 'alto', 'tenor', 'bass')),
	CONSTRAINT "midi_files_label_length" CHECK(label is null or (length(trim(label)) between 1 and 60 and length(label) <= 60)),
	CONSTRAINT "midi_files_storage_key_check" CHECK(substr(storage_key, 1, 5) = 'midi/' and length(substr(storage_key, 6, 36)) = 36 and substr(storage_key, 6, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 42) = '.mid'),
	CONSTRAINT "midi_files_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 1048576)
);
--> statement-breakpoint
CREATE INDEX `midi_files_piece_idx` ON `midi_files` (`piece_id`,`voice_part`);--> statement-breakpoint
CREATE UNIQUE INDEX `midi_files_storage_key_idx` ON `midi_files` (`storage_key`);--> statement-breakpoint
CREATE TABLE `recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`replaces_id` text,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_ms` integer,
	`uploaded_at` integer DEFAULT (unixepoch()) NOT NULL,
	`replaced_at` integer,
	`commented_at` integer,
	`delete_on` text NOT NULL,
	`audio_deleted_at` integer,
	`deleted_reason` text,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`replaces_id`) REFERENCES `recordings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recordings_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "recordings_content_type_check" CHECK(content_type in ('audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/wav')),
	CONSTRAINT "recordings_storage_key_check" CHECK(substr(storage_key, 1, 11) = 'recordings/' and length(substr(storage_key, 12, 36)) = 36 and substr(storage_key, 12, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 48) = '.' || case content_type when 'audio/mp4' then 'm4a' when 'audio/mpeg' then 'mp3' when 'audio/aac' then 'aac' when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg' when 'audio/wav' then 'wav' end),
	CONSTRAINT "recordings_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 4194304),
	CONSTRAINT "recordings_duration_check" CHECK(duration_ms is null or (typeof(duration_ms) = 'integer' and duration_ms between 0 and 600000)),
	CONSTRAINT "recordings_replaces_self" CHECK(replaces_id is null or replaces_id <> id),
	CONSTRAINT "recordings_replaced" CHECK(replaced_at is null or (replaced_at >= uploaded_at and audio_deleted_at is not null and commented_at is null)),
	CONSTRAINT "recordings_commented" CHECK(commented_at is null or commented_at >= uploaded_at),
	CONSTRAINT "recordings_delete_on" CHECK(delete_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(delete_on) is delete_on and delete_on > date(uploaded_at, 'unixepoch')),
	CONSTRAINT "recordings_deleted" CHECK((audio_deleted_at is null) = (deleted_reason is null) and (deleted_reason is null or deleted_reason in ('replaced', 'withdrawn', 'conductor', 'retention', 'early', 'missing')) and (audio_deleted_at is null or audio_deleted_at >= uploaded_at))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_current_idx` ON `recordings` (`assignment_id`,`user_id`) WHERE replaced_at is null;--> statement-breakpoint
CREATE INDEX `recordings_slot_idx` ON `recordings` (`assignment_id`,`user_id`,`uploaded_at`);--> statement-breakpoint
CREATE INDEX `recordings_user_idx` ON `recordings` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_replaces_idx` ON `recordings` (`replaces_id`) WHERE replaces_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `recordings_storage_key_idx` ON `recordings` (`storage_key`);--> statement-breakpoint
CREATE INDEX `recordings_live_idx` ON `recordings` (`delete_on`,`size_bytes`) WHERE audio_deleted_at is null;--> statement-breakpoint
CREATE INDEX `recordings_commented_idx` ON `recordings` (`commented_at`) WHERE audio_deleted_at is null and commented_at is not null;--> statement-breakpoint
CREATE TABLE `storage_deletions` (
	`storage_key` text PRIMARY KEY NOT NULL,
	`area` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`not_before` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_error` text,
	`done_at` integer,
	CONSTRAINT "storage_deletions_area_check" CHECK(area in ('recording', 'midi')),
	CONSTRAINT "storage_deletions_state_check" CHECK(state in ('pending', 'done')),
	CONSTRAINT "storage_deletions_key_check" CHECK((area = 'recording' and substr(storage_key, 1, 11) = 'recordings/' and length(substr(storage_key, 12, 36)) = 36 and substr(storage_key, 12, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 48) in ('.m4a', '.mp3', '.aac', '.webm', '.ogg', '.wav')) or (area = 'midi' and substr(storage_key, 1, 5) = 'midi/' and length(substr(storage_key, 6, 36)) = 36 and substr(storage_key, 6, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 42) = '.mid')),
	CONSTRAINT "storage_deletions_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 4194304),
	CONSTRAINT "storage_deletions_done" CHECK((state = 'done') = (done_at is not null)),
	CONSTRAINT "storage_deletions_attempts" CHECK(typeof(attempts) = 'integer' and attempts >= 0 and (attempts = 0) = (last_attempt_at is null) and (last_error is null or (last_error in ('unavailable', 'suspended', 'rate_limited', 'auth', 'fault', 'unknown') and attempts >= 1))),
	CONSTRAINT "storage_deletions_not_before" CHECK(not_before is null or state = 'pending')
);
--> statement-breakpoint
CREATE INDEX `storage_deletions_pending_idx` ON `storage_deletions` (`requested_at`) WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX `storage_deletions_done_idx` ON `storage_deletions` (`done_at`) WHERE state = 'done';--> statement-breakpoint
CREATE TABLE `storage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`bytes` integer NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "storage_events_kind_check" CHECK(kind in ('put', 'get')),
	CONSTRAINT "storage_events_bytes_check" CHECK(typeof(bytes) = 'integer' and bytes between 1 and 4194304)
);
--> statement-breakpoint
CREATE INDEX `storage_events_kind_at_idx` ON `storage_events` (`kind`,`at`,`bytes`);--> statement-breakpoint
CREATE TABLE `storage_sweeps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL,
	`expired` integer NOT NULL,
	`deleted` integer NOT NULL,
	`failed` integer NOT NULL,
	CONSTRAINT "storage_sweeps_reason_check" CHECK(reason in ('cron', 'early')),
	CONSTRAINT "storage_sweeps_status_check" CHECK(status in ('ok', 'partial', 'failed')),
	CONSTRAINT "storage_sweeps_time" CHECK(finished_at >= started_at),
	CONSTRAINT "storage_sweeps_counts" CHECK(typeof(expired) = 'integer' and typeof(deleted) = 'integer' and typeof(failed) = 'integer' and expired >= 0 and deleted >= 0 and failed >= 0)
);

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
