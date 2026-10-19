CREATE INDEX `rehearsals_open_idx` ON `rehearsals` (`starts_at`) WHERE opened_at is not null and closed_at is null;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "terms_dates_order" CHECK(ends_on >= starts_on),
	CONSTRAINT "terms_dates_format" CHECK(starts_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and ends_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "terms_name_length" CHECK(length(name) between 1 and 40)
);
--> statement-breakpoint
INSERT INTO `__new_terms`("id", "name", "starts_on", "ends_on", "created_at") SELECT "id", "name", "starts_on", "ends_on", "created_at" FROM `terms`;--> statement-breakpoint
DROP TABLE `terms`;--> statement-breakpoint
ALTER TABLE `__new_terms` RENAME TO `terms`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `terms_name_unique` ON `terms` (`name`);--> statement-breakpoint
CREATE INDEX `terms_starts_idx` ON `terms` (`starts_on`);--> statement-breakpoint
CREATE TABLE `__new_users` (
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
	CONSTRAINT "users_left_matches_active" CHECK((is_active = 1) = (left_at is null)),
	CONSTRAINT "users_left_after_joined" CHECK(left_at is null or left_at >= joined_at)
);
--> statement-breakpoint
INSERT INTO `__new_users`("id", "name", "email", "phone", "role", "voice_part", "password_hash", "is_active", "joined_at", "left_at", "last_login_at", "created_at") SELECT "id", "name", "email", "phone", "role", "voice_part", "password_hash", "is_active", "joined_at", "left_at", "last_login_at", "created_at" FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);