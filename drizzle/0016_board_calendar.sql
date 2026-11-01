ALTER TABLE `board_tickets` ADD `on_calendar` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `board_tickets_calendar_idx` ON `board_tickets` (`due_on`) WHERE on_calendar = 1;