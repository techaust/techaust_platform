ALTER TABLE `leads` ADD `duplicate_of` text REFERENCES leads(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `proposal_id` text;--> statement-breakpoint
CREATE INDEX `leads_created` ON `leads` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `leads_last_activity` ON `leads` (`last_activity_at`,`id`);--> statement-breakpoint
CREATE INDEX `leads_next_action` ON `leads` (`next_action_at`,`id`);--> statement-breakpoint
CREATE INDEX `leads_duplicate_of` ON `leads` (`duplicate_of`);--> statement-breakpoint
CREATE INDEX `leads_proposal` ON `leads` (`proposal_id`);--> statement-breakpoint
CREATE INDEX `notifications_entity` ON `notifications` (`entity_type`,`entity_id`);
--> statement-breakpoint
-- M3.2 retention: a lead without a deletion date gets one (last activity, else creation, plus the leads retention default
-- of 12 months; VERIFY WITH CA/LEGAL). Web leads already have one from the jobs Worker; this covers any other row. Data only.
UPDATE `leads` SET `last_activity_at` = coalesce(`last_activity_at`, `created_at`), `delete_after` = cast(strftime('%s', datetime(coalesce(`last_activity_at`, `created_at`) / 1000, 'unixepoch', '+12 months')) as integer) * 1000 WHERE `delete_after` IS NULL;
