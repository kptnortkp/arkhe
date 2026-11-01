CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`kind` text DEFAULT 'other' NOT NULL,
	`day` text NOT NULL,
	`start_time` text,
	`end_time` text,
	`location` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "calendar_events_title_length" CHECK(length(trim(title)) between 1 and 120),
	CONSTRAINT "calendar_events_kind_check" CHECK(kind in ('concert', 'meeting', 'trip', 'other')),
	CONSTRAINT "calendar_events_day_format" CHECK(day glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(day) is day),
	CONSTRAINT "calendar_events_times" CHECK((start_time is null or start_time glob '[0-2][0-9]:[0-5][0-9]')
        and (end_time is null or (start_time is not null and end_time glob '[0-2][0-9]:[0-5][0-9]' and end_time > start_time))),
	CONSTRAINT "calendar_events_location_length" CHECK(location is null or length(trim(location)) between 1 and 120),
	CONSTRAINT "calendar_events_note_length" CHECK(note is null or length(trim(note)) between 1 and 1000)
);
--> statement-breakpoint
CREATE INDEX `calendar_events_day_idx` ON `calendar_events` (`day`);