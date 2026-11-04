CREATE TABLE `piece_audio` (
	`id` text PRIMARY KEY NOT NULL,
	`piece_id` text NOT NULL,
	`voice_part` text,
	`label` text,
	`storage_key` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "piece_audio_id_check" CHECK(length(id) = 36 and id not glob '*[^0-9a-f-]*'),
	CONSTRAINT "piece_audio_voice_part_check" CHECK(voice_part is null or voice_part in ('soprano', 'alto', 'tenor', 'bass')),
	CONSTRAINT "piece_audio_label_length" CHECK(label is null or (length(trim(label)) between 1 and 60 and length(label) <= 60)),
	CONSTRAINT "piece_audio_content_type_check" CHECK(content_type in ('audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/webm', 'audio/ogg', 'audio/wav')),
	CONSTRAINT "piece_audio_storage_key_check" CHECK(substr(storage_key, 1, 11) = 'recordings/' and length(substr(storage_key, 12, 36)) = 36 and substr(storage_key, 12, 36) not glob '*[^0-9a-f-]*' and substr(storage_key, 48) = '.' || case content_type when 'audio/mp4' then 'm4a' when 'audio/mpeg' then 'mp3' when 'audio/aac' then 'aac' when 'audio/webm' then 'webm' when 'audio/ogg' then 'ogg' when 'audio/wav' then 'wav' end),
	CONSTRAINT "piece_audio_size_check" CHECK(typeof(size_bytes) = 'integer' and size_bytes between 1 and 4194304)
);
--> statement-breakpoint
CREATE INDEX `piece_audio_piece_idx` ON `piece_audio` (`piece_id`,`voice_part`);--> statement-breakpoint
CREATE UNIQUE INDEX `piece_audio_storage_key_idx` ON `piece_audio` (`storage_key`);--> statement-breakpoint
CREATE TRIGGER `piece_audio_queue_on_delete` AFTER DELETE ON `piece_audio`
BEGIN INSERT INTO `storage_deletions` (storage_key, area, size_bytes) VALUES (OLD.storage_key, 'recording', OLD.size_bytes); END;
