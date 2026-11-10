CREATE TABLE `exhibition_result_saves` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`activity_id` text NOT NULL,
	`official_email` text NOT NULL,
	`rows` text NOT NULL,
	`replaces_id` text,
	`client_created_at` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exhibition_result_saves_id_unique` ON `exhibition_result_saves` (`id`);--> statement-breakpoint
CREATE INDEX `exhibition_result_saves_activity` ON `exhibition_result_saves` (`activity_id`);