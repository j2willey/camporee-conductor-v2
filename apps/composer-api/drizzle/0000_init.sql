CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`organization_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`json` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_kind" CHECK(kind IN ('event', 'activity', 'common-field-set', 'template'))
);
--> statement-breakpoint
CREATE INDEX `documents_organization_kind` ON `documents` (`organization_id`,`kind`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`organization_id`, `user_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memberships_role" CHECK(role IN ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organizations_slug_unique` ON `organizations` (`slug`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);