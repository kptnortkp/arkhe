CREATE TABLE `dues_overrides` (
	`dues_period_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`owed_kurus` integer NOT NULL,
	`reason` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`dues_period_id`, `user_id`),
	FOREIGN KEY (`dues_period_id`) REFERENCES `dues_periods`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "dues_overrides_kind_check" CHECK(kind in ('waiver', 'freeze')),
	CONSTRAINT "dues_overrides_owed" CHECK(typeof(owed_kurus) = 'integer' and ((kind = 'waiver' and owed_kurus = 0) or (kind = 'freeze' and owed_kurus between 1 and 1000000000))),
	CONSTRAINT "dues_overrides_reason_length" CHECK(length(trim(reason)) between 3 and 200)
);
--> statement-breakpoint
CREATE INDEX `dues_overrides_user_idx` ON `dues_overrides` (`user_id`);--> statement-breakpoint
CREATE TABLE `dues_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`due_on` text NOT NULL,
	`amount_kurus` integer NOT NULL,
	`reduced_amount_kurus` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "dues_periods_name_length" CHECK(length(trim(name)) between 1 and 40),
	CONSTRAINT "dues_periods_dates" CHECK(starts_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and ends_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and due_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and ends_on >= starts_on and due_on >= starts_on),
	CONSTRAINT "dues_periods_amount" CHECK(typeof(amount_kurus) = 'integer' and amount_kurus between 1 and 1000000000),
	CONSTRAINT "dues_periods_reduced" CHECK(reduced_amount_kurus is null or (typeof(reduced_amount_kurus) = 'integer' and reduced_amount_kurus between 1 and amount_kurus - 1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dues_periods_name_unique` ON `dues_periods` (`name`);--> statement-breakpoint
CREATE INDEX `dues_periods_starts_idx` ON `dues_periods` (`starts_on`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`rehearsal_id` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`rehearsal_id`) REFERENCES `rehearsals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "events_name_length" CHECK(length(trim(name)) between 1 and 80),
	CONSTRAINT "events_starts_format" CHECK(starts_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_rehearsal_idx` ON `events` (`rehearsal_id`) WHERE rehearsal_id is not null;--> statement-breakpoint
CREATE INDEX `events_starts_idx` ON `events` (`starts_on`);--> statement-breakpoint
CREATE TABLE `finance_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`category` text,
	`amount_kurus` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`account` text NOT NULL,
	`to_account` text,
	`description` text,
	`counterparty` text,
	`document_url` text,
	`sponsor_id` text,
	`event_id` text,
	`member_id` text,
	`dues_period_id` text,
	`payment_group_id` text,
	`replaces_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	`updated_at` integer,
	`voided_at` integer,
	`voided_by` text,
	`void_reason` text,
	FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`member_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dues_period_id`) REFERENCES `dues_periods`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`replaces_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`voided_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "fe_kind" CHECK(kind in ('income', 'expense', 'transfer', 'opening')),
	CONSTRAINT "fe_account" CHECK(account in ('cash', 'bank') and (to_account is null or to_account in ('cash', 'bank'))),
	CONSTRAINT "fe_transfer" CHECK((kind = 'transfer') = (to_account is not null) and (to_account is null or to_account <> account)),
	CONSTRAINT "fe_category_present" CHECK((kind in ('income', 'expense')) = (category is not null)),
	CONSTRAINT "fe_category_income" CHECK(kind <> 'income' or category in ('dues', 'sponsorship', 'tickets', 'donation', 'grant', 'other_income')),
	CONSTRAINT "fe_category_expense" CHECK(kind <> 'expense' or category in ('costume', 'venue', 'musician_fee', 'scores_royalties', 'travel', 'festival_fee', 'organisation', 'catering', 'refund', 'bank_fee', 'other_expense')),
	CONSTRAINT "fe_amount" CHECK(typeof(amount_kurus) = 'integer' and amount_kurus between 1 and 1000000000),
	CONSTRAINT "fe_occurred_format" CHECK(occurred_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
	CONSTRAINT "fe_sponsor" CHECK((category is 'sponsorship') = (sponsor_id is not null)),
	CONSTRAINT "fe_dues" CHECK((category is 'dues') = (member_id is not null) and (category is 'dues') = (dues_period_id is not null) and (payment_group_id is null or category is 'dues')),
	CONSTRAINT "fe_event" CHECK(event_id is null or kind in ('income', 'expense')),
	CONSTRAINT "fe_texts" CHECK((description is null or length(trim(description)) between 1 and 200) and (counterparty is null or length(trim(counterparty)) between 1 and 120)),
	CONSTRAINT "fe_document" CHECK(document_url is null or (document_url like 'https://%' and length(document_url) <= 2000)),
	CONSTRAINT "fe_updated_pair" CHECK((updated_at is null) = (updated_by is null)),
	CONSTRAINT "fe_void_triple" CHECK((voided_at is null) = (voided_by is null) and (voided_at is null) = (void_reason is null)),
	CONSTRAINT "fe_void_reason" CHECK(void_reason is null or length(trim(void_reason)) between 5 and 200),
	CONSTRAINT "fe_replaces_self" CHECK(replaces_id is null or replaces_id <> id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fe_opening_idx` ON `finance_entries` (`account`) WHERE kind = 'opening' and voided_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX `fe_replaces_idx` ON `finance_entries` (`replaces_id`) WHERE replaces_id is not null;--> statement-breakpoint
CREATE INDEX `fe_occurred_idx` ON `finance_entries` (`occurred_on`,`created_at`);--> statement-breakpoint
CREATE INDEX `fe_event_idx` ON `finance_entries` (`event_id`);--> statement-breakpoint
CREATE INDEX `fe_sponsor_idx` ON `finance_entries` (`sponsor_id`,`occurred_on`);--> statement-breakpoint
CREATE INDEX `fe_member_idx` ON `finance_entries` (`member_id`,`dues_period_id`);--> statement-breakpoint
CREATE INDEX `fe_period_idx` ON `finance_entries` (`dues_period_id`);--> statement-breakpoint
CREATE TABLE `member_dues` (
	`user_id` text PRIMARY KEY NOT NULL,
	`rate` text NOT NULL,
	`note` text,
	`updated_by` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "member_dues_rate_check" CHECK(rate in ('standard', 'reduced', 'exempt')),
	CONSTRAINT "member_dues_note_length" CHECK(note is null or length(trim(note)) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE `sponsors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`contact_name` text,
	`contact` text,
	`note` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "sponsors_name_length" CHECK(length(trim(name)) between 1 and 120),
	CONSTRAINT "sponsors_texts" CHECK((contact_name is null or length(trim(contact_name)) between 1 and 80) and (contact is null or length(trim(contact)) between 1 and 120) and (note is null or length(trim(note)) between 1 and 500))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsors_name_key_idx` ON `sponsors` (`name_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_settings_key_check" CHECK(key in ('recording_email', 'dues_payment_info')),
	CONSTRAINT "app_settings_value_length" CHECK(length(value) between 1 and 2000),
	CONSTRAINT "app_settings_payment_info" CHECK(key <> 'dues_payment_info' or length(value) <= 500),
	CONSTRAINT "app_settings_recording_email" CHECK(key <> 'recording_email' or (value = lower(trim(value)) and length(value) <= 254 and value like '%_@_%._%'))
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("key", "value", "updated_at", "updated_by") SELECT "key", "value", "updated_at", "updated_by" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;