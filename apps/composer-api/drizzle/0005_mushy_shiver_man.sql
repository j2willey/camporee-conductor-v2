PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`user_id` text,
	`organization_id` text,
	`action` text NOT NULL,
	`document_kind` text,
	`document_id` text,
	`detail` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_audit_log`("id", "at", "user_id", "organization_id", "action", "document_kind", "document_id", "detail") SELECT "id", "at", "user_id", "organization_id", "action", "document_kind", "document_id", "detail" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_log_organization_at` ON `audit_log` (`organization_id`,`at`);--> statement-breakpoint
ALTER TABLE `users` ADD `sysadmin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `suspended` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `last_seen_at` integer;