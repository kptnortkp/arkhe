CREATE TABLE `announcement_parts` (
	`announcement_id` text NOT NULL,
	`voice_part` text NOT NULL,
	PRIMARY KEY(`announcement_id`, `voice_part`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "announcement_parts_voice_check" CHECK(voice_part in ('soprano', 'alto', 'tenor', 'bass'))
);
--> statement-breakpoint
CREATE TABLE `announcement_reads` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `announcement_reads_user_idx` ON `announcement_reads` (`user_id`,`announcement_id`);--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`audience` text NOT NULL,
	`important` integer DEFAULT false NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`show_until` text NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "announcements_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "announcements_title_check" CHECK(title = trim(title) and length(title) between 3 and 80),
	CONSTRAINT "announcements_body_check" CHECK(length(trim(body)) between 1 and 1000 and length(body) <= 1000),
	CONSTRAINT "announcements_audience_check" CHECK(audience in ('all', 'parts', 'board')),
	CONSTRAINT "announcements_important_check" CHECK(important in (0, 1)),
	CONSTRAINT "announcements_show_until_check" CHECK(show_until glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(show_until) is show_until)
);
--> statement-breakpoint
CREATE INDEX `announcements_created_idx` ON `announcements` (`created_at`) WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX `announcements_created_by_idx` ON `announcements` (`created_by`);