CREATE TABLE `activity_closures` (
	`received_seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`judge_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`score_ids` text NOT NULL,
	`after_score_seq` integer NOT NULL,
	`phone_created_at` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`judge_id`) REFERENCES `judges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_closures_id_unique` ON `activity_closures` (`id`);--> statement-breakpoint
CREATE INDEX `activity_closures_activity` ON `activity_closures` (`activity_id`);