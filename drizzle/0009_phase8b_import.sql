CREATE TABLE `import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'imported' NOT NULL,
	`file_name` text NOT NULL,
	`file_size` integer NOT NULL,
	`file_sha256` text NOT NULL,
	`row_count` integer NOT NULL,
	`added_count` integer NOT NULL,
	`updated_count` integer NOT NULL,
	`unchanged_count` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`undone_at` integer,
	`undone_by` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`undone_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "import_batches_kind_check" CHECK(kind in ('members', 'terms', 'attendance', 'entries', 'dues_periods', 'dues_payments')),
	CONSTRAINT "import_batches_status_check" CHECK(status in ('imported', 'undone')),
	CONSTRAINT "import_batches_undo" CHECK((status = 'undone') = (undone_at is not null) and (undone_at is null) = (undone_by is null) and (undone_at is null or undone_at >= created_at)),
	CONSTRAINT "import_batches_file_name" CHECK(length(trim(file_name)) between 1 and 120 and length(file_name) <= 120 and file_name not glob ('*[' || char(1, 9, 10, 13, 47, 92) || ']*')),
	CONSTRAINT "import_batches_file_size" CHECK(typeof(file_size) = 'integer' and file_size between 1 and 1048576),
	CONSTRAINT "import_batches_sha" CHECK(length(file_sha256) = 64 and file_sha256 not glob '*[^0-9a-f]*'),
	CONSTRAINT "import_batches_counts" CHECK(typeof(row_count) = 'integer' and typeof(added_count) = 'integer' and typeof(updated_count) = 'integer' and typeof(unchanged_count) = 'integer' and row_count between 1 and 5000 and added_count >= 0 and updated_count >= 0 and unchanged_count >= 0 and added_count + updated_count + unchanged_count = row_count and added_count + updated_count >= 1)
);
--> statement-breakpoint
CREATE INDEX `import_batches_kind_idx` ON `import_batches` (`kind`,`id`);--> statement-breakpoint
CREATE INDEX `import_batches_sha_idx` ON `import_batches` (`file_sha256`);--> statement-breakpoint
CREATE TABLE `import_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`target` text NOT NULL,
	`action` text NOT NULL,
	`user_id` text,
	`term_id` text,
	`rehearsal_id` text,
	`finance_entry_id` text,
	`dues_period_id` text,
	`override_period_id` text,
	`override_user_id` text,
	`sponsor_id` text,
	`kayit_scope` text,
	`kayit_no` text,
	`before_json` text,
	`after_json` text,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`term_id`) REFERENCES `terms`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`rehearsal_id`) REFERENCES `rehearsals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`finance_entry_id`) REFERENCES `finance_entries`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`dues_period_id`) REFERENCES `dues_periods`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`sponsor_id`) REFERENCES `sponsors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`override_period_id`,`override_user_id`) REFERENCES `dues_overrides`(`dues_period_id`,`user_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_items_target_check" CHECK(target in ('user', 'term', 'rehearsal', 'finance_entry', 'dues_period', 'dues_override', 'sponsor')),
	CONSTRAINT "import_items_action_check" CHECK(action in ('create', 'update')),
	CONSTRAINT "import_items_one_target" CHECK(coalesce(case target when 'user' then term_id is null and rehearsal_id is null and finance_entry_id is null and dues_period_id is null and override_period_id is null and sponsor_id is null and user_id is not null when 'term' then user_id is null and rehearsal_id is null and finance_entry_id is null and dues_period_id is null and override_period_id is null and sponsor_id is null when 'rehearsal' then user_id is null and term_id is null and finance_entry_id is null and dues_period_id is null and override_period_id is null and sponsor_id is null when 'finance_entry' then user_id is null and term_id is null and rehearsal_id is null and dues_period_id is null and override_period_id is null and sponsor_id is null and finance_entry_id is not null when 'dues_period' then user_id is null and term_id is null and rehearsal_id is null and finance_entry_id is null and override_period_id is null and sponsor_id is null when 'dues_override' then user_id is null and term_id is null and rehearsal_id is null and finance_entry_id is null and dues_period_id is null and sponsor_id is null when 'sponsor' then user_id is null and term_id is null and rehearsal_id is null and finance_entry_id is null and dues_period_id is null and override_period_id is null and sponsor_id is not null end, 0)),
	CONSTRAINT "import_items_override_pair" CHECK((override_period_id is null) = (override_user_id is null)),
	CONSTRAINT "import_items_update_is_user" CHECK(action = 'create' or target = 'user'),
	CONSTRAINT "import_items_kayit" CHECK((kayit_no is null) = (kayit_scope is null) and (kayit_scope is null or kayit_scope in ('entries', 'dues_payments')) and (kayit_no is null or (length(kayit_no) between 1 and 40 and kayit_no not glob '*[^A-Za-z0-9._/-]*')) and (kayit_no is null or target in ('finance_entry', 'dues_override')) and (target <> 'finance_entry' or kayit_no is not null)),
	CONSTRAINT "import_items_json" CHECK((action = 'update') = (before_json is not null) and (before_json is null or (json_valid(before_json) and length(before_json) <= 4000)) and (after_json is null or (json_valid(after_json) and length(after_json) <= 4000)) and (target not in ('user', 'rehearsal', 'dues_period', 'dues_override', 'sponsor') or after_json is not null))
);
--> statement-breakpoint
CREATE INDEX `import_items_batch_idx` ON `import_items` (`batch_id`,`target`);--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_kayit_idx` ON `import_items` (`kayit_scope`,`kayit_no`) WHERE kayit_no is not null;--> statement-breakpoint
CREATE INDEX `import_items_user_idx` ON `import_items` (`user_id`) WHERE user_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_term_idx` ON `import_items` (`term_id`) WHERE term_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_rehearsal_idx` ON `import_items` (`rehearsal_id`) WHERE rehearsal_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_entry_idx` ON `import_items` (`finance_entry_id`) WHERE finance_entry_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_period_idx` ON `import_items` (`dues_period_id`) WHERE dues_period_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_override_idx` ON `import_items` (`override_period_id`,`override_user_id`) WHERE override_period_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `import_items_sponsor_idx` ON `import_items` (`sponsor_id`) WHERE sponsor_id is not null;