CREATE TABLE `attendance` (
	`rehearsal_id` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`method` text NOT NULL,
	`note` text,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	`recorded_by` text,
	`corrected_at` integer,
	PRIMARY KEY(`rehearsal_id`, `user_id`),
	FOREIGN KEY (`rehearsal_id`) REFERENCES `rehearsals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`recorded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "attendance_status_check" CHECK(status in ('present', 'late', 'excused', 'absent')),
	CONSTRAINT "attendance_method_check" CHECK(method in ('qr', 'code', 'manual', 'self', 'auto')),
	CONSTRAINT "attendance_self_is_excuse" CHECK(method <> 'self' or status = 'excused'),
	CONSTRAINT "attendance_auto_is_absent" CHECK(method <> 'auto' or status = 'absent'),
	CONSTRAINT "attendance_checkin_attended" CHECK(method not in ('qr', 'code') or status in ('present', 'late')),
	CONSTRAINT "attendance_note_length" CHECK(note is null or length(note) <= 200)
);
--> statement-breakpoint
CREATE INDEX `attendance_user_idx` ON `attendance` (`user_id`,`rehearsal_id`);--> statement-breakpoint
CREATE TABLE `invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`purpose` text DEFAULT 'invite' NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "invites_purpose_check" CHECK(purpose in ('invite', 'reset'))
);
--> statement-breakpoint
CREATE INDEX `invites_user_idx` ON `invites` (`user_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`attempted_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempts_key_idx` ON `login_attempts` (`key`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `piece_files` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`voice_part` text,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `piece_files_piece_idx` ON `piece_files` (`piece_id`);--> statement-breakpoint
CREATE TABLE `pieces` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`composer` text,
	`arranger` text,
	`notes` text,
	`drive_folder_url` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rehearsal_parts` (
	`rehearsal_id` text NOT NULL,
	`voice_part` text NOT NULL,
	PRIMARY KEY(`rehearsal_id`, `voice_part`),
	FOREIGN KEY (`rehearsal_id`) REFERENCES `rehearsals`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rehearsal_parts_voice_check" CHECK(voice_part in ('soprano', 'alto', 'tenor', 'bass'))
);
--> statement-breakpoint
CREATE TABLE `rehearsal_secrets` (
	`rehearsal_id` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL,
	`rotated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`rehearsal_id`) REFERENCES `rehearsals`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rehearsals` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'tutti' NOT NULL,
	`title` text,
	`location` text,
	`note` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`series_id` text,
	`cancelled_at` integer,
	`cancelled_by` text,
	`opened_at` integer,
	`closed_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "rehearsals_type_check" CHECK(type in ('tutti', 'sectional', 'dress', 'concert')),
	CONSTRAINT "rehearsals_time_order" CHECK(ends_at > starts_at),
	CONSTRAINT "rehearsals_closed_after_open" CHECK(closed_at is null or (opened_at is not null and closed_at >= opened_at)),
	CONSTRAINT "rehearsals_cancelled_not_open" CHECK(cancelled_at is null or opened_at is null),
	CONSTRAINT "rehearsals_title_length" CHECK(title is null or length(title) <= 80),
	CONSTRAINT "rehearsals_note_length" CHECK(note is null or length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX `rehearsals_starts_idx` ON `rehearsals` (`starts_at`);--> statement-breakpoint
CREATE INDEX `rehearsals_series_idx` ON `rehearsals` (`series_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `terms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "terms_dates_order" CHECK(ends_on >= starts_on),
	CONSTRAINT "terms_name_length" CHECK(length(name) between 1 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_name_unique` ON `terms` (`name`);--> statement-breakpoint
CREATE INDEX `terms_starts_idx` ON `terms` (`starts_on`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`role` text DEFAULT 'member' NOT NULL,
	`voice_part` text,
	`password_hash` text,
	`is_active` integer DEFAULT true NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()) NOT NULL,
	`left_at` integer,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "users_role_check" CHECK(role in ('conductor', 'board', 'member')),
	CONSTRAINT "users_voice_part_check" CHECK(voice_part is null or voice_part in ('soprano', 'alto', 'tenor', 'bass')),
	CONSTRAINT "users_email_lower_check" CHECK(email = lower(email)),
	CONSTRAINT "users_left_matches_active" CHECK((is_active = 1) = (left_at is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);