CREATE INDEX `fe_payment_group_idx` ON `finance_entries` (`payment_group_id`) WHERE payment_group_id is not null;--> statement-breakpoint
DELETE FROM `dues_overrides` WHERE `kind` = 'freeze' AND NOT EXISTS (SELECT 1 FROM `finance_entries` f WHERE f.`member_id` = `dues_overrides`.`user_id` AND f.`dues_period_id` = `dues_overrides`.`dues_period_id` AND f.`voided_at` IS NULL);
