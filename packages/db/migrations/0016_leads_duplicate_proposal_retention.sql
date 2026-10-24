ALTER TABLE `leads` ADD `duplicate_of` text REFERENCES leads(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `proposal_id` text REFERENCES documents(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `leads_created` ON `leads` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `leads_last_activity` ON `leads` (`last_activity_at`,`id`);--> statement-breakpoint
CREATE INDEX `leads_next_action` ON `leads` (`next_action_at`,`id`);--> statement-breakpoint
CREATE INDEX `leads_duplicate_of` ON `leads` (`duplicate_of`);--> statement-breakpoint
CREATE INDEX `leads_proposal` ON `leads` (`proposal_id`);--> statement-breakpoint
CREATE INDEX `leads_stage_activity` ON `leads` (`stage`,`last_activity_at`,`id`);--> statement-breakpoint
CREATE INDEX `leads_service_code` ON `leads` (`service_code`);--> statement-breakpoint
CREATE INDEX `leads_name_nocase` ON `leads` ("contact_name" collate nocase);--> statement-breakpoint
CREATE INDEX `leads_company_nocase` ON `leads` ("contact_company" collate nocase);--> statement-breakpoint
CREATE INDEX `leads_delete_due` ON `leads` (`delete_after`,`id`) WHERE "leads"."client_id" is null and "leads"."legal_hold" = 0;--> statement-breakpoint
CREATE INDEX `notifications_entity` ON `notifications` (`entity_type`,`entity_id`);--> statement-breakpoint
-- M3.2 retention backfill: a lead without a deletion date gets last activity (else creation) plus the leads retention, from the
-- ONE shared expression (core: LEAD_RETENTION_MONTHS_SQL / deleteAfterSql): the stored retention.leadsMonths, at least 12, else 12.
-- Web leads already have a date from the jobs Worker; this covers any other row. Data only. VERIFY WITH CA/LEGAL.
UPDATE `leads` SET `last_activity_at` = coalesce(`last_activity_at`, `created_at`), `delete_after` = (cast(strftime('%s', datetime(coalesce(`last_activity_at`, `created_at`) / 1000, 'unixepoch', '+' || max(12, coalesce((SELECT json_extract(value, '$.leadsMonths') FROM settings WHERE key = 'retention'), 12)) || ' months')) AS integer) * 1000 + (coalesce(`last_activity_at`, `created_at`) % 1000)) WHERE `delete_after` IS NULL;
