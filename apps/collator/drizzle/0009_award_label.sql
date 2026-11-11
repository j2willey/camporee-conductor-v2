CREATE TABLE `award_label_saves` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`official_email` text NOT NULL,
	`label` text NOT NULL,
	`client_created_at` text NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `award_label_saves_id_unique` ON `award_label_saves` (`id`);