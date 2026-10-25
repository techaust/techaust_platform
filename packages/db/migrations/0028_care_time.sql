CREATE TABLE `stats_daily` (
	`date` text NOT NULL,
	`metric` text NOT NULL,
	`dimension` text DEFAULT '' NOT NULL,
	`value` integer NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`date`, `metric`, `dimension`),
	CONSTRAINT "stats_daily_date" CHECK(date("stats_daily"."date") is "stats_daily"."date"),
	CONSTRAINT "stats_daily_value" CHECK(typeof("stats_daily"."value") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `stats_daily_metric` ON `stats_daily` (`metric`,`date`);--> statement-breakpoint
CREATE TABLE `care_plan_status_log` (
	`id` text PRIMARY KEY NOT NULL,
	`care_plan_id` text NOT NULL,
	`status` text NOT NULL,
	`effective_on` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`care_plan_id`) REFERENCES `care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "care_plan_status_log_status" CHECK("care_plan_status_log"."status" in ('active', 'paused', 'cancelled')),
	CONSTRAINT "care_plan_status_log_date" CHECK(date("care_plan_status_log"."effective_on") is "care_plan_status_log"."effective_on")
);
--> statement-breakpoint
CREATE INDEX `care_plan_status_log_plan` ON `care_plan_status_log` (`care_plan_id`,`effective_on`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `care_plan_terms` (
	`id` text PRIMARY KEY NOT NULL,
	`care_plan_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`tier` text NOT NULL,
	`price_minor` integer NOT NULL,
	`included_minutes` integer NOT NULL,
	`ai_ops_minor` integer,
	`overage_rate_minor` integer,
	`rollover` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`care_plan_id`) REFERENCES `care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "care_plan_terms_date" CHECK(date("care_plan_terms"."effective_from") is "care_plan_terms"."effective_from"),
	CONSTRAINT "care_plan_terms_tier" CHECK("care_plan_terms"."tier" in ('essential', 'growth', 'scale', 'dev_subscription', 'custom')),
	CONSTRAINT "care_plan_terms_rollover" CHECK("care_plan_terms"."rollover" in ('none', 'one_month')),
	CONSTRAINT "care_plan_terms_price" CHECK("care_plan_terms"."price_minor" >= 0),
	CONSTRAINT "care_plan_terms_included" CHECK("care_plan_terms"."included_minutes" >= 0 and "care_plan_terms"."included_minutes" % 15 = 0),
	CONSTRAINT "care_plan_terms_ai_ops" CHECK("care_plan_terms"."ai_ops_minor" is null or "care_plan_terms"."ai_ops_minor" >= 0),
	CONSTRAINT "care_plan_terms_rate" CHECK("care_plan_terms"."overage_rate_minor" is null or "care_plan_terms"."overage_rate_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `care_plan_terms_plan` ON `care_plan_terms` (`care_plan_id`,`effective_from`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `time_logs_date` ON `time_logs` (`work_date`,`id`);--> statement-breakpoint
CREATE INDEX `time_logs_care_usage` ON `time_logs` (`care_plan_id`,`work_date`,`billable`,`minutes`);--> statement-breakpoint
CREATE INDEX `care_plans_created` ON `care_plans` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `care_plans_status_created` ON `care_plans` (`status`,`created_at`,`id`);