ALTER TABLE `storage_events` ADD `area` text CONSTRAINT "storage_events_area_check" CHECK(area is null or area in ('recording', 'midi'));
