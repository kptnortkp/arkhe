PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_piece_links` (
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
	CONSTRAINT "piece_links_label_length" CHECK(label is null or length(trim(label)) between 1 and 120),
	CONSTRAINT "piece_links_url_check" CHECK(substr(url, 1, 8) = 'https://' and length(url) <= 2000),
	CONSTRAINT "piece_links_position_check" CHECK(position >= 1)
);
--> statement-breakpoint
INSERT INTO `__new_piece_links`("id", "piece_id", "kind", "voice_part", "label", "url", "position", "created_at") SELECT "id", "piece_id", "kind", "voice_part", "label", "url", "position", "created_at" FROM `piece_links`;--> statement-breakpoint
DROP TABLE `piece_links`;--> statement-breakpoint
ALTER TABLE `__new_piece_links` RENAME TO `piece_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `piece_links_piece_url_unique` ON `piece_links` (`piece_id`,`url`);--> statement-breakpoint
CREATE INDEX `piece_links_piece_position_idx` ON `piece_links` (`piece_id`,`position`);