ALTER TABLE `assignments` ADD `cancelled_at` integer;--> statement-breakpoint
ALTER TABLE `assignments` ADD `cancelled_by` text REFERENCES users(id) ON DELETE set null;
