CREATE TABLE `notification_prefs` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_prefs_key_check" CHECK(key in ('calisma', 'devamsizlik', 'odev', 'dinleme', 'repertuvar', 'yonetim', 'aidat', 'butce', 'sistem', 'gece'))
);
--> statement-breakpoint
CREATE TABLE `notification_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notification_state_key_length" CHECK(length(key) between 1 and 64),
	CONSTRAINT "notification_state_value_length" CHECK(length(value) <= 200)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`group_key` text,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`tag` text NOT NULL,
	`line` text,
	`urgent` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`delivered_to` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`sent_at` integer,
	`lease_until` integer,
	`merged_into` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_status_check" CHECK(status in ('pending', 'held', 'sent', 'failed', 'dropped', 'merged')),
	CONSTRAINT "notifications_group_check" CHECK(group_key is null or group_key in ('calisma', 'devamsizlik', 'odev', 'dinleme', 'repertuvar', 'yonetim', 'aidat', 'butce', 'sistem', 'gece')),
	CONSTRAINT "notifications_url_check" CHECK(substr(url, 1, 1) = '/' and substr(url, 2, 1) <> '/'),
	CONSTRAINT "notifications_lengths" CHECK(length(title) between 1 and 40 and length(body) between 1 and 400 and length(tag) between 1 and 64 and length(dedupe_key) <= 200),
	CONSTRAINT "notifications_attempts" CHECK(typeof(attempts) = 'integer' and attempts >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_user_dedupe_idx` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_due_idx` ON `notifications` (`status`,`created_at`) WHERE status in ('pending', 'held');--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_user_kind_idx` ON `notifications` (`user_id`,`kind`,`created_at`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_success_at` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`first_fail_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_subscriptions_endpoint_check" CHECK(substr(endpoint, 1, 8) = 'https://' and length(endpoint) <= 1024),
	CONSTRAINT "push_subscriptions_keys_check" CHECK(length(p256dh) = 87 and length(auth) = 22),
	CONSTRAINT "push_subscriptions_label_length" CHECK(length(label) between 1 and 40),
	CONSTRAINT "push_subscriptions_fail_check" CHECK(typeof(fail_count) = 'integer' and fail_count >= 0 and (fail_count = 0) = (first_fail_at is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_idx` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_user_idx` ON `push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE INDEX `push_subscriptions_session_idx` ON `push_subscriptions` (`session_id`);