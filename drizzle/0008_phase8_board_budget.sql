CREATE TABLE `board_ticket_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`body` text,
	`client_key` text,
	`from_value` text,
	`to_value` text,
	`from_user_id` text,
	`to_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `board_tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`from_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "board_ticket_events_kind_check" CHECK(kind in ('created', 'status', 'assignee', 'urgency', 'due', 'comment')),
	CONSTRAINT "board_ticket_events_body" CHECK((kind = 'comment') = (body is not null) and (body is null or (length(trim(body)) >= 1 and length(body) <= 2000))),
	CONSTRAINT "board_ticket_events_client_key" CHECK(client_key is null or kind = 'comment'),
	CONSTRAINT "board_ticket_events_users" CHECK(kind = 'assignee' or (from_user_id is null and to_user_id is null)),
	CONSTRAINT "board_ticket_events_values" CHECK(coalesce(case kind
        when 'status' then from_value in ('todo', 'in_progress', 'blocked', 'done') and to_value in ('todo', 'in_progress', 'blocked', 'done') and from_value <> to_value
        when 'urgency' then from_value in ('low', 'medium', 'high', 'urgent') and to_value in ('low', 'medium', 'high', 'urgent') and from_value <> to_value
        when 'due' then (from_value is null or date(from_value) is from_value) and (to_value is null or date(to_value) is to_value) and from_value is not to_value
        when 'assignee' then from_value is null and to_value is null and from_user_id is not to_user_id
        else from_value is null and to_value is null end, 0))
);
--> statement-breakpoint
CREATE INDEX `board_ticket_events_ticket_idx` ON `board_ticket_events` (`ticket_id`);--> statement-breakpoint
CREATE INDEX `board_ticket_events_comments_idx` ON `board_ticket_events` (`ticket_id`) WHERE kind = 'comment';--> statement-breakpoint
CREATE UNIQUE INDEX `board_ticket_events_client_key_idx` ON `board_ticket_events` (`client_key`) WHERE client_key is not null;--> statement-breakpoint
CREATE TABLE `board_ticket_reads` (
	`user_id` text NOT NULL,
	`ticket_id` text NOT NULL,
	`seen_event_id` integer NOT NULL,
	`seen_revision` integer NOT NULL,
	`seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `ticket_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ticket_id`) REFERENCES `board_tickets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "board_ticket_reads_seen" CHECK(typeof(seen_event_id) = 'integer' and seen_event_id >= 0 and typeof(seen_revision) = 'integer' and seen_revision >= 0)
);
--> statement-breakpoint
CREATE INDEX `board_ticket_reads_ticket_idx` ON `board_ticket_reads` (`ticket_id`);--> statement-breakpoint
CREATE TABLE `board_ticket_seq` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_number` integer NOT NULL,
	CONSTRAINT "board_ticket_seq_single" CHECK(id = 1),
	CONSTRAINT "board_ticket_seq_last" CHECK(typeof(last_number) = 'integer' and last_number >= 0)
);
--> statement-breakpoint
CREATE TABLE `board_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`urgency` text DEFAULT 'medium' NOT NULL,
	`assignee_id` text,
	`due_on` text,
	`done_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "board_tickets_number_check" CHECK(typeof(number) = 'integer' and number >= 1),
	CONSTRAINT "board_tickets_status_check" CHECK(status in ('todo', 'in_progress', 'blocked', 'done')),
	CONSTRAINT "board_tickets_urgency_check" CHECK(urgency in ('low', 'medium', 'high', 'urgent')),
	CONSTRAINT "board_tickets_title_length" CHECK(length(trim(title)) between 3 and 120 and length(title) <= 120),
	CONSTRAINT "board_tickets_description_length" CHECK(description is null or length(trim(description)) between 1 and 4000),
	CONSTRAINT "board_tickets_due_format" CHECK(due_on is null or (due_on glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]' and date(due_on) is due_on)),
	CONSTRAINT "board_tickets_done_at" CHECK((status = 'done') = (done_at is not null)),
	CONSTRAINT "board_tickets_revision_check" CHECK(typeof(revision) = 'integer' and revision >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `board_tickets_number_idx` ON `board_tickets` (`number`);--> statement-breakpoint
CREATE INDEX `board_tickets_status_idx` ON `board_tickets` (`status`,`done_at`);--> statement-breakpoint
CREATE INDEX `board_tickets_assignee_idx` ON `board_tickets` (`assignee_id`,`status`);--> statement-breakpoint
CREATE TABLE `budget_lines` (
	`budget_id` text NOT NULL,
	`category` text NOT NULL,
	`amount_kurus` integer NOT NULL,
	PRIMARY KEY(`budget_id`, `category`),
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_lines_category_check" CHECK(category in ('dues', 'sponsorship', 'tickets', 'donation', 'grant', 'other_income', 'costume', 'venue', 'musician_fee', 'scores_royalties', 'travel', 'festival_fee', 'organisation', 'catering', 'refund', 'bank_fee', 'other_expense')),
	CONSTRAINT "budget_lines_amount" CHECK(typeof(amount_kurus) = 'integer' and amount_kurus between 1 and 1000000000)
);
--> statement-breakpoint
CREATE TABLE `budget_revision_lines` (
	`revision_id` integer NOT NULL,
	`category` text NOT NULL,
	`from_kurus` integer NOT NULL,
	`to_kurus` integer NOT NULL,
	PRIMARY KEY(`revision_id`, `category`),
	FOREIGN KEY (`revision_id`) REFERENCES `budget_revisions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_revision_lines_category_check" CHECK(category in ('dues', 'sponsorship', 'tickets', 'donation', 'grant', 'other_income', 'costume', 'venue', 'musician_fee', 'scores_royalties', 'travel', 'festival_fee', 'organisation', 'catering', 'refund', 'bank_fee', 'other_expense')),
	CONSTRAINT "budget_revision_lines_amounts" CHECK(typeof(from_kurus) = 'integer' and typeof(to_kurus) = 'integer' and from_kurus between 0 and 1000000000 and to_kurus between 0 and 1000000000 and from_kurus <> to_kurus)
);
--> statement-breakpoint
CREATE TABLE `budget_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_id` text NOT NULL,
	`reason` text NOT NULL,
	`actor_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "budget_revisions_reason_length" CHECK(length(trim(reason)) between 5 and 200 and length(reason) <= 200)
);
--> statement-breakpoint
CREATE INDEX `budget_revisions_budget_idx` ON `budget_revisions` (`budget_id`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text NOT NULL,
	`note` text,
	`approved_at` integer,
	`approved_by` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer,
	`updated_by` text,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "budgets_name_length" CHECK(length(trim(name)) between 1 and 40 and length(name) <= 40),
	CONSTRAINT "budgets_start_format" CHECK(start_month glob '[0-9][0-9][0-9][0-9]-[0-1][0-9]' and strftime('%Y-%m', start_month || '-01') is start_month),
	CONSTRAINT "budgets_end_month" CHECK(end_month is strftime('%Y-%m', start_month || '-01', '+12 months')),
	CONSTRAINT "budgets_note_length" CHECK(note is null or length(trim(note)) between 1 and 500),
	CONSTRAINT "budgets_approved_pair" CHECK((approved_at is null) = (approved_by is null)),
	CONSTRAINT "budgets_updated_pair" CHECK((updated_at is null) = (updated_by is null)),
	CONSTRAINT "budgets_revision_check" CHECK(typeof(revision) = 'integer' and revision >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_name_idx` ON `budgets` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_start_idx` ON `budgets` (`start_month`);--> statement-breakpoint
CREATE TRIGGER `budgets_no_overlap_insert` BEFORE INSERT ON `budgets`
WHEN EXISTS (SELECT 1 FROM `budgets` b WHERE b.start_month < NEW.end_month AND NEW.start_month < b.end_month)
BEGIN SELECT RAISE(ABORT, 'budgets_overlap'); END;--> statement-breakpoint
CREATE TRIGGER `budgets_no_overlap_update` BEFORE UPDATE OF start_month, end_month ON `budgets`
WHEN EXISTS (SELECT 1 FROM `budgets` b WHERE b.id <> NEW.id AND b.start_month < NEW.end_month AND NEW.start_month < b.end_month)
BEGIN SELECT RAISE(ABORT, 'budgets_overlap'); END;
