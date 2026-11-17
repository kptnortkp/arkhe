-- deploy: reviewed: the UPDATE only fills the new opens_on column; no existing value changes.
ALTER TABLE `festivals` ADD `opens_on` text;--> statement-breakpoint
-- The spreadsheet's "15 Kasım 2026" for Trabzon is the day applications open, not the deadline.
UPDATE `festivals` SET `opens_on` = '2026-11-15' WHERE `id` = 'e61d0f91-f11e-52d2-9a06-37531917aeba' AND `opens_on` IS NULL;
