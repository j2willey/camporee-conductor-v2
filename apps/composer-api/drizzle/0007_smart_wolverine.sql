ALTER TABLE `documents` ADD `created_at` integer;--> statement-breakpoint
-- Older documents (ADR-0032 notes, #104 PR 3): their first audit row, else their last update.
UPDATE `documents` SET `created_at` = coalesce(
  (SELECT min(`at`) FROM `audit_log` WHERE `audit_log`.`document_id` = `documents`.`id`),
  `updated_at`
);
