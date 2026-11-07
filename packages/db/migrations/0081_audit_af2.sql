ALTER TABLE `retention_run_counts` ADD `pages` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `retention_run_counts` ADD `capped` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `retention_run_counts` ADD `more_tomorrow` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `pdf_failures` ADD `refused_at` integer;