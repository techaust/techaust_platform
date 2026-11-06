CREATE TABLE `consent_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_hash` text,
	`lead_id` text,
	`contact_id` text,
	`event` text NOT NULL,
	`source` text NOT NULL,
	`notice_version` text,
	`purposes` text NOT NULL,
	`marketing` integer DEFAULT false NOT NULL,
	`ip_hash` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `consent_receipts_subject` ON `consent_receipts` (`subject_hash`,`at`);--> statement-breakpoint
CREATE INDEX `consent_receipts_at` ON `consent_receipts` (`at`,`id`);--> statement-breakpoint
CREATE INDEX `consent_receipts_lead` ON `consent_receipts` (`lead_id`,`at`);--> statement-breakpoint
CREATE INDEX `consent_receipts_contact` ON `consent_receipts` (`contact_id`,`at`);--> statement-breakpoint
CREATE TABLE `legal_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`by` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legal_holds_reason_length" CHECK(length("legal_holds"."reason") between 1 and 500)
);
--> statement-breakpoint
CREATE INDEX `legal_holds_entity` ON `legal_holds` (`entity_type`,`entity_id`,`at`);--> statement-breakpoint
CREATE TABLE `r2_deletions` (
	`id` integer PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`key` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "r2_deletions_key_length" CHECK(length("r2_deletions"."key") between 1 and 512),
	CONSTRAINT "r2_deletions_attempts" CHECK("r2_deletions"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `r2_deletions_key` ON `r2_deletions` (`bucket`,`key`);--> statement-breakpoint
CREATE INDEX `r2_deletions_created` ON `r2_deletions` (`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `retention_run_counts` (
	`run_id` text NOT NULL,
	`family` text NOT NULL,
	`due` integer DEFAULT 0 NOT NULL,
	`held_skipped` integer DEFAULT 0 NOT NULL,
	`oldest_at` integer,
	`done` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`run_id`, `family`),
	FOREIGN KEY (`run_id`) REFERENCES `retention_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "retention_run_counts_values" CHECK("retention_run_counts"."due" >= 0 and "retention_run_counts"."held_skipped" >= 0)
);
--> statement-breakpoint
CREATE TABLE `retention_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`as_of` integer NOT NULL,
	`mode` text NOT NULL,
	`started_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`finished_at` integer,
	`families` integer NOT NULL,
	CONSTRAINT "retention_runs_families" CHECK("retention_runs"."families" > 0)
);
--> statement-breakpoint
CREATE INDEX `retention_runs_started` ON `retention_runs` (`started_at`,`id`);--> statement-breakpoint
CREATE TABLE `retention_switches` (
	`id` text PRIMARY KEY NOT NULL,
	`live` integer DEFAULT false NOT NULL,
	`by` text NOT NULL,
	`run_id` text,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "retention_switches_run" CHECK("retention_switches"."live" = 0 or "retention_switches"."run_id" is not null)
);
--> statement-breakpoint
CREATE INDEX `retention_switches_at` ON `retention_switches` (`at`,`id`);--> statement-breakpoint
ALTER TABLE `contacts` ADD `erased_hash` text;--> statement-breakpoint
ALTER TABLE `leads` ADD `erased_hash` text;--> statement-breakpoint
CREATE INDEX `leads_contact_email_lower` ON `leads` (lower("contact_email"));--> statement-breakpoint
ALTER TABLE `client_requests` ADD `received_at` integer;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `due_at` integer;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `ack_due_at` integer;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `acknowledged_at` integer;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `channel` text DEFAULT 'portal' NOT NULL;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `logged_by` text REFERENCES staff_users(id);--> statement-breakpoint
ALTER TABLE `client_requests` ADD `identity_checked_at` integer;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `identity_checked_by` text REFERENCES staff_users(id);--> statement-breakpoint
ALTER TABLE `client_requests` ADD `decline_reason` text;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `action_audit_id` text;--> statement-breakpoint
ALTER TABLE `client_requests` ADD `export_sent_at` integer;--> statement-breakpoint
CREATE INDEX `client_requests_due` ON `client_requests` (`due_at`,`id`) WHERE "client_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX `client_requests_open_erasure` ON `client_requests` (`lead_ref`) WHERE "client_requests"."kind" = 'data_erasure' and "client_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX `auth_attempts_window` ON `auth_attempts` (`window_start`);--> statement-breakpoint
CREATE INDEX `client_sessions_abs` ON `client_sessions` (`abs_expires_at`);--> statement-breakpoint
CREATE INDEX `magic_link_tokens_expires` ON `magic_link_tokens` (`expires_at`);--> statement-breakpoint
CREATE INDEX `notifications_created` ON `notifications` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `staff_sessions_abs` ON `staff_sessions` (`abs_expires_at`);