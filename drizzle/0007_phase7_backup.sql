CREATE TABLE `backup_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`report_month` text NOT NULL,
	`trigger` text NOT NULL,
	`actor_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`size_bytes` integer,
	`recipient_count` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "backup_runs_month_check" CHECK(report_month glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and substr(report_month, 6, 2) between '01' and '12'),
	CONSTRAINT "backup_runs_trigger_check" CHECK(trigger in ('cron', 'manual')),
	CONSTRAINT "backup_runs_status_check" CHECK(status in ('running', 'sent', 'failed')),
	CONSTRAINT "backup_runs_cron_actor" CHECK(trigger = 'manual' or actor_id is null),
	CONSTRAINT "backup_runs_finished" CHECK((status = 'running') = (finished_at is null) and (finished_at is null or finished_at >= started_at)),
	CONSTRAINT "backup_runs_error" CHECK((status = 'failed') = (error is not null) and (error is null or length(trim(error)) between 1 and 500)),
	CONSTRAINT "backup_runs_size" CHECK(size_bytes is null or (typeof(size_bytes) = 'integer' and size_bytes between 0 and 1000000000)),
	CONSTRAINT "backup_runs_recipients" CHECK(typeof(recipient_count) = 'integer' and recipient_count between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_runs_running_idx` ON `backup_runs` (`report_month`) WHERE status = 'running';--> statement-breakpoint
CREATE INDEX `backup_runs_month_status_idx` ON `backup_runs` (`report_month`,`status`);--> statement-breakpoint
CREATE INDEX `backup_runs_started_idx` ON `backup_runs` (`started_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "app_settings_key_check" CHECK(key in ('recording_email', 'dues_payment_info', 'backup_recipients')),
	CONSTRAINT "app_settings_value_length" CHECK(length(value) between 1 and 2000),
	CONSTRAINT "app_settings_payment_info" CHECK(key <> 'dues_payment_info' or length(value) <= 500),
	CONSTRAINT "app_settings_recording_email" CHECK(key <> 'recording_email' or (value = lower(trim(value)) and length(value) <= 254 and value like '%_@_%._%')),
	CONSTRAINT "app_settings_backup_recipients" CHECK(key <> 'backup_recipients' or (value = lower(value) and value not glob ('*[ <>"' || char(9, 10, 13, 59) || ']*') and length(value) <= 1274 and value like '%_@_%._%' and value not like ',%' and value not like '%,' and instr(value, ',,') = 0 and length(value) - length(replace(value, ',', '')) <= 4 and length(value) - length(replace(value, '@', '')) = length(value) - length(replace(value, ',', '')) + 1))
);
--> statement-breakpoint
INSERT INTO `__new_app_settings`("key", "value", "created_at", "updated_at", "updated_by") SELECT "key", "value", "updated_at", "updated_at", "updated_by" FROM `app_settings`;--> statement-breakpoint
DROP TABLE `app_settings`;--> statement-breakpoint
ALTER TABLE `__new_app_settings` RENAME TO `app_settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;