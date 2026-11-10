CREATE TABLE `roster_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`official_email` text NOT NULL,
	`change` text NOT NULL,
	`notes` text,
	`client_created_at` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roster_changes_id_unique` ON `roster_changes` (`id`);