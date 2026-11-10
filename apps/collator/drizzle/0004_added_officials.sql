CREATE TABLE `added_officials` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`role` text NOT NULL,
	`added_at` integer NOT NULL,
	CONSTRAINT "added_officials_role" CHECK(role IN ('director', 'official'))
);
