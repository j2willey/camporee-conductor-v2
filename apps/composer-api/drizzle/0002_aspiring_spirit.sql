CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`user_id` text,
	`organization_id` text NOT NULL,
	`action` text NOT NULL,
	`document_kind` text,
	`document_id` text,
	`detail` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_log_organization_at` ON `audit_log` (`organization_id`,`at`);