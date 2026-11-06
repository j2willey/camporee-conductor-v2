PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`organization_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`json` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_kind" CHECK(kind IN ('event', 'activity', 'common-field-set', 'template', 'officials'))
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "kind", "organization_id", "slug", "title", "json", "updated_at") SELECT "id", "kind", "organization_id", "slug", "title", "json", "updated_at" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `documents_organization_kind` ON `documents` (`organization_id`,`kind`);