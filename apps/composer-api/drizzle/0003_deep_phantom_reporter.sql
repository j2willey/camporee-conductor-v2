CREATE TABLE `invites` (
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `email`),
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invites_role" CHECK(role IN ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE INDEX `invites_email` ON `invites` (`email`);