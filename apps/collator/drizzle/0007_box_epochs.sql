CREATE TABLE `box_epochs` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`reason` text NOT NULL,
	`at` integer NOT NULL,
	CONSTRAINT "box_epochs_reason" CHECK(reason IN ('created', 'restore', 'reset'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `box_epochs_id_unique` ON `box_epochs` (`id`);