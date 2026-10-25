CREATE TABLE `omr_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`error_kind` text,
	`expected` integer,
	`found` integer,
	`layout` text NOT NULL,
	`piano` integer NOT NULL,
	`tempo` integer,
	`run_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "omr_jobs_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "omr_jobs_state_check" CHECK(state in ('queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "omr_jobs_error_check" CHECK((state = 'failed') = (error_kind is not null) and (error_kind is null or error_kind in ('pdf_unreadable', 'too_many_pages', 'no_music', 'layout_mismatch', 'output_invalid', 'not_started', 'timeout', 'dispatch_auth', 'dispatch_failed', 'storage_full', 'unknown'))),
	CONSTRAINT "omr_jobs_mismatch_check" CHECK((expected is null) = (found is null) and (expected is null or (error_kind = 'layout_mismatch' and typeof(expected) = 'integer' and typeof(found) = 'integer' and expected between 0 and 40 and found between 0 and 40))),
	CONSTRAINT "omr_jobs_layout_check" CHECK(layout in ('satb', 'kadin_erkek', 'sa_tb', 'auto')),
	CONSTRAINT "omr_jobs_tempo_check" CHECK(tempo is null or (typeof(tempo) = 'integer' and tempo between 40 and 220)),
	CONSTRAINT "omr_jobs_run_id_check" CHECK(run_id is null or (length(run_id) between 1 and 20 and run_id not glob '*[^0-9]*')),
	CONSTRAINT "omr_jobs_finished_check" CHECK((state in ('succeeded', 'failed')) = (finished_at is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `omr_jobs_active_idx` ON `omr_jobs` (`piece_id`) WHERE state in ('queued', 'running');--> statement-breakpoint
CREATE INDEX `omr_jobs_piece_idx` ON `omr_jobs` (`piece_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `omr_jobs_created_idx` ON `omr_jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `omr_jobs_creator_idx` ON `omr_jobs` (`created_by`,`created_at`);--> statement-breakpoint
CREATE TABLE `piece_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`uploaded_by` text,
	`uploaded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "piece_scores_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "piece_scores_storage_key_check" CHECK(substr(storage_key, 1, 7) = 'scores/' and length(substr(storage_key, 8, 36)) = 36 and substr(storage_key, 8, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 44) = '.pdf'),
	CONSTRAINT "piece_scores_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 4194304)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `piece_scores_piece_idx` ON `piece_scores` (`piece_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `piece_scores_storage_key_idx` ON `piece_scores` (`storage_key`);--> statement-breakpoint
-- 0010's queue triggers insert into storage_deletions: dropped for its rebuild, recreated below unchanged.
DROP TRIGGER `recordings_queue_on_audio_delete`;--> statement-breakpoint
DROP TRIGGER `recordings_queue_on_delete`;--> statement-breakpoint
DROP TRIGGER `midi_files_queue_on_delete`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_storage_deletions` (
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
	CONSTRAINT "storage_deletions_area_check" CHECK(area in ('recording', 'midi', 'score')),
	CONSTRAINT "storage_deletions_state_check" CHECK(state in ('pending', 'done')),
	CONSTRAINT "storage_deletions_key_check" CHECK((area = 'recording' and substr(storage_key, 1, 11) = 'recordings/' and length(substr(storage_key, 12, 36)) = 36 and substr(storage_key, 12, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 48) in ('.m4a', '.mp3', '.aac', '.webm', '.ogg', '.wav')) or (area = 'midi' and substr(storage_key, 1, 5) = 'midi/' and length(substr(storage_key, 6, 36)) = 36 and substr(storage_key, 6, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 42) = '.mid') or (area = 'score' and substr(storage_key, 1, 7) = 'scores/' and length(substr(storage_key, 8, 36)) = 36 and substr(storage_key, 8, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 44) = '.pdf')),
	CONSTRAINT "storage_deletions_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 4194304),
	CONSTRAINT "storage_deletions_done" CHECK((state = 'done') = (done_at is not null)),
	CONSTRAINT "storage_deletions_attempts" CHECK(typeof(attempts) = 'integer' and attempts >= 0 and (attempts = 0) = (last_attempt_at is null) and (last_error is null or (last_error in ('unavailable', 'suspended', 'rate_limited', 'auth', 'fault', 'unknown') and attempts >= 1))),
	CONSTRAINT "storage_deletions_not_before" CHECK(not_before is null or state = 'pending')
);
--> statement-breakpoint
INSERT INTO `__new_storage_deletions`("storage_key", "area", "size_bytes", "state", "requested_at", "not_before", "attempts", "last_attempt_at", "last_error", "done_at") SELECT "storage_key", "area", "size_bytes", "state", "requested_at", "not_before", "attempts", "last_attempt_at", "last_error", "done_at" FROM `storage_deletions`;--> statement-breakpoint
DROP TABLE `storage_deletions`;--> statement-breakpoint
ALTER TABLE `__new_storage_deletions` RENAME TO `storage_deletions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `storage_deletions_pending_idx` ON `storage_deletions` (`requested_at`) WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX `storage_deletions_done_idx` ON `storage_deletions` (`done_at`) WHERE state = 'done';--> statement-breakpoint
CREATE TRIGGER `recordings_queue_on_audio_delete` AFTER UPDATE OF audio_deleted_at ON `recordings`
WHEN OLD.audio_deleted_at IS NULL AND NEW.audio_deleted_at IS NOT NULL
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (NEW.storage_key, 'recording', NEW.size_bytes); END;--> statement-breakpoint
CREATE TRIGGER `recordings_queue_on_delete` AFTER DELETE ON `recordings`
WHEN OLD.audio_deleted_at IS NULL
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (OLD.storage_key, 'recording', OLD.size_bytes); END;--> statement-breakpoint
CREATE TRIGGER `midi_files_queue_on_delete` AFTER DELETE ON `midi_files`
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (OLD.storage_key, 'midi', OLD.size_bytes); END;--> statement-breakpoint
CREATE TRIGGER `piece_scores_queue_on_delete` AFTER DELETE ON `piece_scores`
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (OLD.storage_key, 'score', OLD.size_bytes); END;--> statement-breakpoint
-- Never a rebuild of midi_files (D95): ADD COLUMN only, CHECKs written here by hand.
ALTER TABLE `midi_files` ADD `auto` integer DEFAULT 0 NOT NULL CONSTRAINT "midi_files_auto_check" CHECK(auto in (0, 1));--> statement-breakpoint
ALTER TABLE `midi_files` ADD `status` text DEFAULT 'published' NOT NULL CONSTRAINT "midi_files_status_check" CHECK(status in ('draft', 'published') and (status = 'published' or auto = 1));--> statement-breakpoint
ALTER TABLE `midi_files` ADD `tracks_json` text CONSTRAINT "midi_files_tracks_check" CHECK(tracks_json is null or (auto = 1 and json_valid(tracks_json) and json_type(tracks_json) = 'array' and length(tracks_json) <= 4000));--> statement-breakpoint
ALTER TABLE `midi_files` ADD `measures` integer CONSTRAINT "midi_files_measures_check" CHECK(measures is null or (auto = 1 and typeof(measures) = 'integer' and measures between 1 and 2000));--> statement-breakpoint
ALTER TABLE `midi_files` ADD `duration_sec` integer CONSTRAINT "midi_files_duration_check" CHECK(duration_sec is null or (auto = 1 and typeof(duration_sec) = 'integer' and duration_sec between 0 and 86400));--> statement-breakpoint
ALTER TABLE `midi_files` ADD `published_by` text REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `midi_files` ADD `published_at` integer CONSTRAINT "midi_files_published_check" CHECK(published_at is null or (auto = 1 and status = 'published'));--> statement-breakpoint
CREATE UNIQUE INDEX `midi_files_auto_idx` ON `midi_files` (`piece_id`,`status`) WHERE auto = 1;--> statement-breakpoint
CREATE TABLE `__new_storage_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`area` text,
	`bytes` integer NOT NULL,
	`at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "storage_events_kind_check" CHECK(kind in ('put', 'get')),
	CONSTRAINT "storage_events_area_check" CHECK(area is null or area in ('recording', 'midi', 'score')),
	CONSTRAINT "storage_events_bytes_check" CHECK(typeof(bytes) = 'integer' and bytes between 1 and 4194304)
);
--> statement-breakpoint
INSERT INTO `__new_storage_events`("id", "kind", "area", "bytes", "at") SELECT "id", "kind", "area", "bytes", "at" FROM `storage_events`;--> statement-breakpoint
DROP TABLE `storage_events`;--> statement-breakpoint
ALTER TABLE `__new_storage_events` RENAME TO `storage_events`;--> statement-breakpoint
CREATE INDEX `storage_events_kind_at_idx` ON `storage_events` (`kind`,`at`,`bytes`);