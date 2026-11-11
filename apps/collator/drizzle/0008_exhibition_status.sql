CREATE TABLE `exhibition_status_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`activity_id` text NOT NULL,
	`official_email` text NOT NULL,
	`final` integer NOT NULL,
	`save_id` text,
	`notes` text,
	`client_created_at` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exhibition_status_changes_id_unique` ON `exhibition_status_changes` (`id`);--> statement-breakpoint
CREATE INDEX `exhibition_status_changes_activity` ON `exhibition_status_changes` (`activity_id`);