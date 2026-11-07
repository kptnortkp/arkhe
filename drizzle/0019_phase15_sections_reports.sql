-- deploy: reviewed (the two UPDATEs only fill the new piece_audio.section and users.handles_reports; no existing column is rewritten, no table rebuilt)
CREATE TABLE `issue_report_images` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`report_id`) REFERENCES `issue_reports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "issue_report_images_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "issue_report_images_content_type_check" CHECK(content_type in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "issue_report_images_storage_key_check" CHECK(substr(storage_key, 1, 8) = 'reports/' and length(substr(storage_key, 9, 36)) = 36 and substr(storage_key, 9, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 45) in ('.jpg', '.png', '.webp') and substr(storage_key, 45) = '.' || case content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end),
	CONSTRAINT "issue_report_images_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 2000000)
);
--> statement-breakpoint
CREATE INDEX `issue_report_images_report_idx` ON `issue_report_images` (`report_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `issue_report_images_storage_key_idx` ON `issue_report_images` (`storage_key`);--> statement-breakpoint
CREATE TABLE `issue_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`reporter_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`reply` text,
	`page` text,
	`device` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "issue_reports_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "issue_reports_number_check" CHECK(typeof(number) = 'integer' and number >= 1),
	CONSTRAINT "issue_reports_title_check" CHECK(title = trim(title) and length(title) between 3 and 120),
	CONSTRAINT "issue_reports_body_check" CHECK(length(trim(body)) between 1 and 4000 and length(body) <= 4000),
	CONSTRAINT "issue_reports_status_check" CHECK(status in ('new', 'in_progress', 'done', 'wontfix')),
	CONSTRAINT "issue_reports_reply_check" CHECK(reply is null or (length(trim(reply)) between 1 and 2000 and length(reply) <= 2000)),
	CONSTRAINT "issue_reports_page_check" CHECK(page is null or length(page) between 1 and 300),
	CONSTRAINT "issue_reports_device_check" CHECK(device is null or length(device) between 1 and 300),
	CONSTRAINT "issue_reports_closed_check" CHECK((status in ('done', 'wontfix')) = (closed_at is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `issue_reports_number_idx` ON `issue_reports` (`number`);--> statement-breakpoint
CREATE INDEX `issue_reports_reporter_idx` ON `issue_reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `issue_reports_status_idx` ON `issue_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `report_image_deletions` (
	`storage_key` text PRIMARY KEY NOT NULL,
	`size_bytes` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`requested_at` integer DEFAULT (unixepoch()) NOT NULL,
	`not_before` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`last_error` text,
	`done_at` integer,
	CONSTRAINT "report_image_deletions_key_check" CHECK(substr(storage_key, 1, 8) = 'reports/' and length(substr(storage_key, 9, 36)) = 36 and substr(storage_key, 9, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 45) in ('.jpg', '.png', '.webp')),
	CONSTRAINT "report_image_deletions_state_check" CHECK(state in ('pending', 'done')),
	CONSTRAINT "report_image_deletions_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 2000000),
	CONSTRAINT "report_image_deletions_done" CHECK((state = 'done') = (done_at is not null)),
	CONSTRAINT "report_image_deletions_attempts" CHECK(typeof(attempts) = 'integer' and attempts >= 0 and (attempts = 0) = (last_attempt_at is null) and (last_error is null or (last_error in ('unavailable', 'suspended', 'rate_limited', 'auth', 'fault', 'unknown') and attempts >= 1))),
	CONSTRAINT "report_image_deletions_not_before" CHECK(not_before is null or state = 'pending')
);
--> statement-breakpoint
CREATE INDEX `report_image_deletions_pending_idx` ON `report_image_deletions` (`requested_at`) WHERE state = 'pending';--> statement-breakpoint
CREATE INDEX `report_image_deletions_done_idx` ON `report_image_deletions` (`done_at`) WHERE state = 'done';--> statement-breakpoint
-- Never a rebuild of users, piece_audio or assignment_parts: ADD COLUMN only, CHECKs written here by hand.
ALTER TABLE `assignment_parts` ADD `section` integer CONSTRAINT "assignment_parts_section_check" CHECK(section is null or section in (1, 2));--> statement-breakpoint
ALTER TABLE `piece_audio` ADD `section` integer CONSTRAINT "piece_audio_section_check" CHECK(section is null or section in (1, 2));--> statement-breakpoint
ALTER TABLE `users` ADD `voice_section` integer CONSTRAINT "users_voice_section_check" CHECK(voice_section is null or voice_section in (1, 2));--> statement-breakpoint
ALTER TABLE `users` ADD `handles_reports` integer DEFAULT false NOT NULL CONSTRAINT "users_handles_reports_check" CHECK(handles_reports in (0, 1));--> statement-breakpoint
-- Labels like "Bas 2", "Alto 1 + Eşlik", "Tenor 1 - Piyano" name a section of their own part; "Bas - Hızlı" doesn't.
UPDATE `piece_audio` SET `section` = CASE
WHEN (voice_part = 'soprano' AND (label LIKE 'Soprano 1' OR label LIKE 'Soprano 1 %')) OR (voice_part = 'alto' AND (label LIKE 'Alto 1' OR label LIKE 'Alto 1 %')) OR (voice_part = 'tenor' AND (label LIKE 'Tenor 1' OR label LIKE 'Tenor 1 %')) OR (voice_part = 'bass' AND (label LIKE 'Bas 1' OR label LIKE 'Bas 1 %')) THEN 1
WHEN (voice_part = 'soprano' AND (label LIKE 'Soprano 2' OR label LIKE 'Soprano 2 %')) OR (voice_part = 'alto' AND (label LIKE 'Alto 2' OR label LIKE 'Alto 2 %')) OR (voice_part = 'tenor' AND (label LIKE 'Tenor 2' OR label LIKE 'Tenor 2 %')) OR (voice_part = 'bass' AND (label LIKE 'Bas 2' OR label LIKE 'Bas 2 %')) THEN 2
END WHERE voice_part IS NOT NULL AND label IS NOT NULL;--> statement-breakpoint
-- The report handler in production (no-op on other databases).
UPDATE `users` SET `handles_reports` = 1 WHERE id = '513103a7-f9b8-4ea0-a064-bf59aa4900b3';--> statement-breakpoint
CREATE TRIGGER `issue_report_images_queue_on_delete` AFTER DELETE ON `issue_report_images`
BEGIN INSERT INTO `report_image_deletions` (storage_key, size_bytes) VALUES (OLD.storage_key, OLD.size_bytes); END;--> statement-breakpoint
CREATE TRIGGER `issue_report_images_max` BEFORE INSERT ON `issue_report_images`
WHEN (SELECT count(*) FROM `issue_report_images` WHERE report_id = NEW.report_id) >= 3
BEGIN SELECT RAISE(ABORT, 'issue_report_images_max'); END;--> statement-breakpoint
CREATE TRIGGER `issue_report_images_key_final` BEFORE UPDATE OF storage_key, size_bytes ON `issue_report_images`
WHEN NEW.storage_key IS NOT OLD.storage_key OR NEW.size_bytes IS NOT OLD.size_bytes
BEGIN SELECT RAISE(ABORT, 'issue_report_images_key_final'); END;