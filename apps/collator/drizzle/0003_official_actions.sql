CREATE TABLE `official_actions` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`official_email` text NOT NULL,
	`action` text NOT NULL,
	`client_created_at` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `official_actions_id_unique` ON `official_actions` (`id`);