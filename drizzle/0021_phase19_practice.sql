CREATE TABLE `calendar_feeds` (
	`user_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "calendar_feeds_token_check" CHECK(length(token) = 43 and token not glob '*[^A-Za-z0-9_-]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_idx` ON `calendar_feeds` (`token`);--> statement-breakpoint
CREATE TABLE `concert_signups` (
	`rehearsal_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`rehearsal_id`, `user_id`),
	FOREIGN KEY (`rehearsal_id`) REFERENCES `rehearsals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `concert_signups_user_idx` ON `concert_signups` (`user_id`);--> statement-breakpoint
CREATE TABLE `piece_readiness` (
	`piece_id` text NOT NULL,
	`user_id` text NOT NULL,
	`level` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`piece_id`, `user_id`),
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "piece_readiness_level_check" CHECK(level in ('not_ready', 'partial', 'ready'))
);
--> statement-breakpoint
CREATE INDEX `piece_readiness_user_idx` ON `piece_readiness` (`user_id`);--> statement-breakpoint
CREATE TABLE `practice_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`rehearsal_id` text NOT NULL,
	`piece_id` text,
	`voice_part` text,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`rehearsal_id`) REFERENCES `rehearsals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "practice_notes_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "practice_notes_voice_check" CHECK(voice_part is null or voice_part in ('soprano', 'alto', 'tenor', 'bass')),
	CONSTRAINT "practice_notes_body_check" CHECK(length(trim(body)) between 1 and 1000 and length(body) <= 1000)
);
--> statement-breakpoint
CREATE INDEX `practice_notes_rehearsal_idx` ON `practice_notes` (`rehearsal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `practice_notes_piece_idx` ON `practice_notes` (`piece_id`,`created_at`) WHERE piece_id is not null;--> statement-breakpoint
CREATE INDEX `practice_notes_created_idx` ON `practice_notes` (`created_at`);--> statement-breakpoint
CREATE INDEX `practice_notes_author_idx` ON `practice_notes` (`author_id`);