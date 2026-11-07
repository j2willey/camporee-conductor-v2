CREATE TABLE `cartridge_loads` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`manifest` text NOT NULL,
	`loaded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `event_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`json` text NOT NULL,
	CONSTRAINT "event_documents_kind" CHECK(kind IN ('event', 'activity', 'common-field-set', 'officials'))
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `judges` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `score_entries` (
	`received_seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`judge_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`entrant_id` text NOT NULL,
	`values` text NOT NULL,
	`phone_created_at` text NOT NULL,
	`received_at` integer NOT NULL,
	FOREIGN KEY (`judge_id`) REFERENCES `judges`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `score_entries_id_unique` ON `score_entries` (`id`);--> statement-breakpoint
CREATE INDEX `score_entries_activity` ON `score_entries` (`activity_id`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
