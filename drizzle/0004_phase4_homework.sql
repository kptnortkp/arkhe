CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_settings_key_check" CHECK(key in ('recording_email')),
	CONSTRAINT "app_settings_value_length" CHECK(length(value) between 1 and 2000),
	CONSTRAINT "app_settings_recording_email" CHECK(key <> 'recording_email' or (value = lower(trim(value)) and length(value) <= 254 and value like '%_@_%._%'))
);
--> statement-breakpoint
CREATE TABLE `assignment_parts` (
	`assignment_id` text NOT NULL,
	`voice_part` text NOT NULL,
	PRIMARY KEY(`assignment_id`, `voice_part`),
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assignment_parts_voice_check" CHECK(voice_part in ('soprano', 'alto', 'tenor', 'bass'))
);
--> statement-breakpoint
CREATE INDEX `assignment_parts_voice_idx` ON `assignment_parts` (`voice_part`,`assignment_id`);--> statement-breakpoint
CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`bar_from` integer,
	`bar_to` integer,
	`description` text,
	`due_at` integer NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "assignments_bars_pair" CHECK((bar_from is null) = (bar_to is null)),
	CONSTRAINT "assignments_bars_range" CHECK(bar_from is null or (bar_from between 1 and 9999 and bar_to between bar_from and 9999)),
	CONSTRAINT "assignments_description_length" CHECK(description is null or length(trim(description)) between 1 and 1000)
);
--> statement-breakpoint
CREATE INDEX `assignments_due_idx` ON `assignments` (`due_at`);--> statement-breakpoint
CREATE INDEX `assignments_piece_due_idx` ON `assignments` (`piece_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`assignment_id` text NOT NULL,
	`user_id` text NOT NULL,
	`submitted_at` integer,
	`method` text,
	`marked_by` text,
	`feedback` text,
	`feedback_by` text,
	`feedback_at` integer,
	`feedback_seen_at` integer,
	PRIMARY KEY(`assignment_id`, `user_id`),
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`feedback_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "submissions_method_check" CHECK(method is null or method in ('self', 'manual')),
	CONSTRAINT "submissions_method_matches" CHECK((submitted_at is null) = (method is null)),
	CONSTRAINT "submissions_marked_by_manual" CHECK(marked_by is null or method = 'manual'),
	CONSTRAINT "submissions_feedback_at_matches" CHECK((feedback is null) = (feedback_at is null)),
	CONSTRAINT "submissions_feedback_meta" CHECK(feedback is not null or (feedback_by is null and feedback_seen_at is null)),
	CONSTRAINT "submissions_feedback_length" CHECK(feedback is null or length(trim(feedback)) between 1 and 1000),
	CONSTRAINT "submissions_not_empty" CHECK(submitted_at is not null or feedback is not null)
);
--> statement-breakpoint
CREATE INDEX `submissions_user_idx` ON `submissions` (`user_id`,`assignment_id`);