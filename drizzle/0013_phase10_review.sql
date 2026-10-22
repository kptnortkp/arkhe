CREATE TABLE `push_removed` (
	`endpoint_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`removed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "push_removed_hash_check" CHECK(length(endpoint_hash) = 64)
);
--> statement-breakpoint
CREATE INDEX `push_removed_user_idx` ON `push_removed` (`user_id`);--> statement-breakpoint
CREATE INDEX `push_removed_at_idx` ON `push_removed` (`removed_at`);