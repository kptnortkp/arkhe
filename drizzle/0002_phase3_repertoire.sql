PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`composer` text,
	`arranger` text,
	`language` text,
	`voicing` text,
	`duration_sec` integer,
	`status` text DEFAULT 'learning' NOT NULL,
	`notes` text,
	`drive_folder_url` text,
	`program_position` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "pieces_status_check" CHECK(status in ('learning', 'concert', 'archive')),
	CONSTRAINT "pieces_title_length" CHECK(length(trim(title)) between 1 and 120),
	CONSTRAINT "pieces_composer_length" CHECK(composer is null or length(composer) between 1 and 120),
	CONSTRAINT "pieces_arranger_length" CHECK(arranger is null or length(arranger) between 1 and 120),
	CONSTRAINT "pieces_language_length" CHECK(language is null or length(language) between 1 and 40),
	CONSTRAINT "pieces_voicing_length" CHECK(voicing is null or length(voicing) between 1 and 20),
	CONSTRAINT "pieces_duration_range" CHECK(duration_sec is null or duration_sec between 1 and 5999),
	CONSTRAINT "pieces_notes_length" CHECK(notes is null or length(notes) between 1 and 1000),
	CONSTRAINT "pieces_folder_url_check" CHECK(drive_folder_url is null or (substr(drive_folder_url, 1, 8) = 'https://' and length(drive_folder_url) <= 2000)),
	CONSTRAINT "pieces_program_position_check" CHECK(program_position is null or program_position >= 1),
	CONSTRAINT "pieces_archive_not_in_program" CHECK(status <> 'archive' or program_position is null)
);
--> statement-breakpoint
INSERT INTO `__new_pieces`("id", "title", "composer", "arranger", "notes", "drive_folder_url", "status", "created_at", "updated_at") SELECT "id", "title", "composer", "arranger", "notes", "drive_folder_url", CASE WHEN "is_active" = 1 THEN 'learning' ELSE 'archive' END, "created_at", "created_at" FROM `pieces`;--> statement-breakpoint
DROP TABLE `pieces`;--> statement-breakpoint
ALTER TABLE `__new_pieces` RENAME TO `pieces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `pieces_status_idx` ON `pieces` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `pieces_program_position_unique` ON `pieces` (`program_position`) WHERE program_position is not null;--> statement-breakpoint
CREATE TABLE `piece_links` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`kind` text NOT NULL,
	`voice_part` text,
	`label` text,
	`url` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "piece_links_kind_check" CHECK(kind in ('score', 'part', 'recording', 'video', 'other')),
	CONSTRAINT "piece_links_voice_part_check" CHECK(voice_part is null or voice_part in ('soprano', 'alto', 'tenor', 'bass')),
	CONSTRAINT "piece_links_label_length" CHECK(label is null or length(trim(label)) between 1 and 80),
	CONSTRAINT "piece_links_url_check" CHECK(substr(url, 1, 8) = 'https://' and length(url) <= 2000),
	CONSTRAINT "piece_links_position_check" CHECK(position >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `piece_links_piece_url_unique` ON `piece_links` (`piece_id`,`url`);--> statement-breakpoint
CREATE INDEX `piece_links_piece_position_idx` ON `piece_links` (`piece_id`,`position`);--> statement-breakpoint
INSERT INTO `piece_links` (`id`, `piece_id`, `kind`, `voice_part`, `label`, `url`, `position`, `created_at`)
SELECT `id`, `piece_id`,
	CASE `kind` WHEN 'midi' THEN 'part' WHEN 'score' THEN 'score' WHEN 'recording' THEN 'recording' ELSE 'other' END,
	CASE WHEN `voice_part` IN ('soprano', 'alto', 'tenor', 'bass') THEN `voice_part` END,
	NULLIF(trim(substr(`label`, 1, 80)), ''),
	`url`,
	row_number() OVER (PARTITION BY `piece_id` ORDER BY `created_at`, `id`),
	`created_at`
FROM `piece_files`
WHERE substr(`url`, 1, 8) = 'https://' AND length(`url`) <= 2000
	AND rowid IN (SELECT min(rowid) FROM `piece_files` GROUP BY `piece_id`, `url`);--> statement-breakpoint
DROP TABLE `piece_files`;