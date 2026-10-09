CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` text NOT NULL,
	`user_id` text,
	`user_email` text,
	`ip` text,
	`action` text NOT NULL,
	`project_id` text,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `audit_at` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_project` ON `audit_log` (`project_id`,`at`);--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor` text NOT NULL,
	`model` text NOT NULL,
	`category` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_vendor_model` ON `catalog_items` (`vendor`,`model`);--> statement-breakpoint
CREATE TABLE `files` (
	`sha256` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`name` text,
	`source_url` text,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `import_usage` (
	`day` text PRIMARY KEY NOT NULL,
	`claude_calls` integer DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`client` text,
	`seq` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`created_by` text,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `records` (
	`project_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`sheet_id` text,
	`data` text NOT NULL,
	`seq` integer NOT NULL,
	`deleted` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`project_id`, `id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `records_project_seq` ON `records` (`project_id`,`seq`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`label` text,
	`sheet_id` text,
	`expires_at` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`last_used_at` text,
	`uses` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_hash_unique` ON `shares` (`token_hash`);