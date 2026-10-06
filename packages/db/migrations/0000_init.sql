CREATE TABLE `catalogue_items` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`short` text NOT NULL,
	`long_md` text,
	`unit` text NOT NULL,
	`price_inr_minor` integer,
	`price_usd_minor` integer,
	`sac` text NOT NULL,
	`gst_rate_bp` integer,
	`default_lines` text,
	`deliverables_md` text,
	`assumptions_md` text,
	`exclusions_md` text,
	`schedule` text NOT NULL,
	`slug` text,
	`show_on_site` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "catalogue_items_category" CHECK("catalogue_items"."category" in ('advise', 'build', 'automate', 'connect', 'run')),
	CONSTRAINT "catalogue_items_unit" CHECK("catalogue_items"."unit" in ('fixed', 'milestone', 'month', 'hour', 'workflow', 'connector', 'document')),
	CONSTRAINT "catalogue_items_sac" CHECK("catalogue_items"."sac" glob '[0-9][0-9][0-9][0-9][0-9][0-9]'),
	CONSTRAINT "catalogue_items_prices" CHECK(coalesce("catalogue_items"."price_inr_minor", 0) >= 0 and coalesce("catalogue_items"."price_usd_minor", 0) >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `catalogue_items_code` ON `catalogue_items` (`code`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalogue_items_slug` ON `catalogue_items` (`slug`) WHERE "catalogue_items"."slug" is not null;--> statement-breakpoint
CREATE TABLE `catalogue_price_history` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`field` text NOT NULL,
	`old_minor` integer,
	`new_minor` integer,
	`changed_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `catalogue_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `catalogue_price_history_item` ON `catalogue_price_history` (`item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `site_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`json` text NOT NULL,
	`published_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`published_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `site_snapshots_published` ON `site_snapshots` (`created_at`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "templates_kind" CHECK("templates"."kind" in ('proposal', 'estimate', 'care_block', 'terms_block'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_kind_category_version` ON `templates` (`kind`,`category`,`version`);--> statement-breakpoint
CREATE TABLE `access_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`realm` text NOT NULL,
	`actor_id` text,
	`method` text NOT NULL,
	`route` text NOT NULL,
	`status` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`request_id` text,
	CONSTRAINT "access_log_realm" CHECK("access_log"."realm" in ('admin', 'portal', 'jobs'))
);
--> statement-breakpoint
CREATE INDEX `access_log_at` ON `access_log` (`at`);--> statement-breakpoint
CREATE INDEX `access_log_actor` ON `access_log` (`actor_id`,`at`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`role` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`summary` text,
	`ip` text,
	`user_agent` text,
	`request_id` text,
	CONSTRAINT "audit_log_actor_type" CHECK("audit_log"."actor_type" in ('staff', 'contact', 'system', 'webhook')),
	CONSTRAINT "audit_log_role" CHECK("audit_log"."role" is null or "audit_log"."role" in ('owner', 'staff', 'sales', 'accountant'))
);
--> statement-breakpoint
CREATE INDEX `audit_log_entity` ON `audit_log` (`entity_type`,`entity_id`,`at`);--> statement-breakpoint
CREATE INDEX `audit_log_at` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_log_actor` ON `audit_log` (`actor_id`,`at`);--> statement-breakpoint
CREATE TABLE `care_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`tier` text NOT NULL,
	`currency` text NOT NULL,
	`price_minor` integer NOT NULL,
	`included_minutes` integer DEFAULT 0 NOT NULL,
	`ai_ops_minor` integer,
	`start_date` text NOT NULL,
	`billing_day` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`rollover` text DEFAULT 'none' NOT NULL,
	`overage_rate_minor` integer,
	`auto_issue` integer DEFAULT false NOT NULL,
	`paused_at` integer,
	`cancelled_at` integer,
	`last_billed_period` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "care_plans_billing_day" CHECK("care_plans"."billing_day" between 1 and 28),
	CONSTRAINT "care_plans_tier" CHECK("care_plans"."tier" in ('essential', 'growth', 'scale', 'dev_subscription', 'custom')),
	CONSTRAINT "care_plans_status" CHECK("care_plans"."status" in ('active', 'paused', 'cancelled')),
	CONSTRAINT "care_plans_rollover" CHECK("care_plans"."rollover" in ('none', 'one_month')),
	CONSTRAINT "care_plans_currency" CHECK("care_plans"."currency" in ('INR', 'USD')),
	CONSTRAINT "care_plans_price" CHECK("care_plans"."price_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `care_plans_client` ON `care_plans` (`client_id`);--> statement-breakpoint
CREATE INDEX `care_plans_status_billing_day` ON `care_plans` (`status`,`billing_day`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`legal_name` text NOT NULL,
	`display_name` text NOT NULL,
	`type` text NOT NULL,
	`country` text NOT NULL,
	`gst_status` text NOT NULL,
	`gstin` text,
	`state_code` text,
	`billing_address` text,
	`service_address` text,
	`currency` text NOT NULL,
	`payment_terms_days` integer,
	`reminder_policy` text,
	`care_auto_issue` integer DEFAULT false NOT NULL,
	`attach_pdf` integer DEFAULT false NOT NULL,
	`tags` text,
	`notes` text,
	`legal_hold` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "clients_type" CHECK("clients"."type" in ('business', 'individual')),
	CONSTRAINT "clients_gst_status" CHECK("clients"."gst_status" in ('registered', 'unregistered', 'overseas')),
	CONSTRAINT "clients_currency" CHECK("clients"."currency" in ('INR', 'USD')),
	CONSTRAINT "clients_gstin_registered" CHECK(("clients"."gst_status" = 'registered') = ("clients"."gstin" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_code` ON `clients` (`code`);--> statement-breakpoint
CREATE INDEX `clients_display_name` ON `clients` (`display_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `clients_gstin` ON `clients` (`gstin`) WHERE "clients"."gstin" is not null;--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`phone` text,
	`title` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`is_billing` integer DEFAULT false NOT NULL,
	`portal_access` integer DEFAULT false NOT NULL,
	`can_see_finance` integer DEFAULT false NOT NULL,
	`marketing_consent` text,
	`bounced_at` integer,
	`anonymised_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contacts_email_lower" CHECK("contacts"."email" = lower("contacts"."email"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_client_email` ON `contacts` (`client_id`,`email`);--> statement-breakpoint
CREATE INDEX `contacts_email` ON `contacts` (`email`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`project_id` text,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "files_size" CHECK("files"."size" between 1 and 26214400)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_r2_key` ON `files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `files_client` ON `files` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `files_project` ON `files` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `lead_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`kind` text NOT NULL,
	`body` text,
	`actor_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `lead_activities_lead` ON `lead_activities` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`ref` text NOT NULL,
	`stage` text DEFAULT 'new' NOT NULL,
	`lost_reason` text,
	`source` text NOT NULL,
	`form_version` text,
	`service_code` text,
	`budget_band` text,
	`timeline` text,
	`currency` text,
	`message` text,
	`tools` text,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`contact_phone` text,
	`contact_company` text,
	`contact_country` text,
	`call_window` text,
	`utm` text,
	`source_page` text,
	`referrer_host` text,
	`consent` text,
	`owner_id` text,
	`next_action_at` integer,
	`next_action_note` text,
	`client_id` text,
	`last_activity_at` integer,
	`delete_after` integer,
	`legal_hold` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "leads_stage" CHECK("leads"."stage" in ('new', 'qualified', 'proposal_sent', 'won', 'lost')),
	CONSTRAINT "leads_source" CHECK("leads"."source" in ('web', 'manual')),
	CONSTRAINT "leads_lost_reason" CHECK(("leads"."stage" = 'lost') = ("leads"."lost_reason" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_ref` ON `leads` (`ref`);--> statement-breakpoint
CREATE INDEX `leads_stage` ON `leads` (`stage`);--> statement-breakpoint
CREATE INDEX `leads_owner_next_action` ON `leads` (`owner_id`,`next_action_at`);--> statement-breakpoint
CREATE INDEX `leads_email` ON `leads` (`contact_email`);--> statement-breakpoint
CREATE INDEX `leads_delete_after` ON `leads` (`delete_after`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`amount_minor` integer,
	`pct_bp` integer,
	`due_date` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`delivered_at` integer,
	`document_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "milestones_status" CHECK("milestones"."status" in ('pending', 'ready_to_bill', 'invoiced', 'paid')),
	CONSTRAINT "milestones_pct" CHECK("milestones"."pct_bp" is null or "milestones"."pct_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_project_position` ON `milestones` (`project_id`,`position`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`project_id` text,
	`visibility` text DEFAULT 'internal' NOT NULL,
	`body_md` text NOT NULL,
	`author_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notes_visibility" CHECK("notes"."visibility" in ('internal', 'shared'))
);
--> statement-breakpoint
CREATE INDEX `notes_client` ON `notes` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notes_project` ON `notes` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`client_id` text NOT NULL,
	`source_document_id` text,
	`name` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`start_date` text,
	`target_date` text,
	`owner_id` text,
	`currency` text NOT NULL,
	`budget_minor` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "projects_status" CHECK("projects"."status" in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
	CONSTRAINT "projects_currency" CHECK("projects"."currency" in ('INR', 'USD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code` ON `projects` (`code`);--> statement-breakpoint
CREATE INDEX `projects_client_status` ON `projects` (`client_id`,`status`);--> statement-breakpoint
CREATE TABLE `time_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`work_date` text NOT NULL,
	`minutes` integer NOT NULL,
	`project_id` text,
	`care_plan_id` text,
	`note` text,
	`billable` integer DEFAULT false NOT NULL,
	`locked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`care_plan_id`) REFERENCES `care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "time_logs_minutes" CHECK("time_logs"."minutes" between 15 and 1440 and "time_logs"."minutes" % 15 = 0)
);
--> statement-breakpoint
CREATE INDEX `time_logs_project_date` ON `time_logs` (`project_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `time_logs_care_plan_date` ON `time_logs` (`care_plan_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `time_logs_user_date` ON `time_logs` (`user_id`,`work_date`);--> statement-breakpoint
CREATE TABLE `acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`session_id` text,
	`typed_name` text NOT NULL,
	`email` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`country` text,
	`pdf_sha256` text NOT NULL,
	`terms_version_id` text,
	`certificate_r2_key` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terms_version_id`) REFERENCES `terms_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `acceptances_document` ON `acceptances` (`document_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`document_id` text,
	`payment_id` text,
	`requested_by` text NOT NULL,
	`reason` text,
	`content_sha256` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "approvals_kind" CHECK("approvals"."kind" in ('discount', 'issue', 'payment_verify', 'refund')),
	CONSTRAINT "approvals_status" CHECK("approvals"."status" in ('pending', 'approved', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE INDEX `approvals_status` ON `approvals` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `approvals_requested_by` ON `approvals` (`requested_by`,`status`);--> statement-breakpoint
CREATE TABLE `document_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`position` integer NOT NULL,
	`catalogue_item_id` text,
	`description` text NOT NULL,
	`sac` text,
	`qty_milli` integer NOT NULL,
	`unit` text NOT NULL,
	`rate_minor` integer NOT NULL,
	`discount_kind` text,
	`discount_value` integer,
	`taxable_minor` integer NOT NULL,
	`gst_rate_bp` integer DEFAULT 0 NOT NULL,
	`cgst_minor` integer DEFAULT 0 NOT NULL,
	`sgst_minor` integer DEFAULT 0 NOT NULL,
	`igst_minor` integer DEFAULT 0 NOT NULL,
	`line_total_minor` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_lines_qty" CHECK("document_lines"."qty_milli" > 0),
	CONSTRAINT "document_lines_discount" CHECK(("document_lines"."discount_kind" is null) = ("document_lines"."discount_value" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_lines_position` ON `document_lines` (`document_id`,`position`);--> statement-breakpoint
CREATE TABLE `document_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`position` integer NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`title` text,
	`body_md` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_sections_position` ON `document_sections` (`document_id`,`position`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`client_id` text NOT NULL,
	`project_id` text,
	`care_plan_id` text,
	`parent_id` text,
	`version_group_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`series` text,
	`fy` text,
	`number` integer,
	`number_display` text,
	`currency` text NOT NULL,
	`issue_date` text,
	`due_date` text,
	`valid_until` text,
	`supply_type` text,
	`place_of_supply_code` text,
	`recipient` text,
	`fx_rate_micros` integer,
	`fx_date` text,
	`fx_source` text,
	`subtotal_minor` integer DEFAULT 0 NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`taxable_minor` integer DEFAULT 0 NOT NULL,
	`cgst_minor` integer DEFAULT 0 NOT NULL,
	`sgst_minor` integer DEFAULT 0 NOT NULL,
	`igst_minor` integer DEFAULT 0 NOT NULL,
	`round_off_minor` integer DEFAULT 0 NOT NULL,
	`total_minor` integer DEFAULT 0 NOT NULL,
	`total_inr_minor` integer,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`credited_minor` integer DEFAULT 0 NOT NULL,
	`balance_minor` integer DEFAULT 0 NOT NULL,
	`terms_version_id` text,
	`snapshot_r2_key` text,
	`snapshot_sha256` text,
	`pdf_r2_key` text,
	`pdf_sha256` text,
	`frozen_at` integer,
	`issued_by` text,
	`voided_at` integer,
	`void_reason` text,
	`realisation_due_at` integer,
	`irn` text,
	`ack_no` text,
	`ack_date` text,
	`signed_qr` text,
	`einv_status` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`care_plan_id`) REFERENCES `care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`terms_version_id`) REFERENCES `terms_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_type" CHECK("documents"."type" in ('proposal', 'estimate', 'proforma', 'tax_invoice', 'export_invoice', 'credit_note', 'debit_note', 'receipt', 'receipt_voucher', 'refund_voucher')),
	CONSTRAINT "documents_status" CHECK("documents"."status" in ('draft', 'pending_approval', 'sent', 'viewed', 'accepted', 'rejected', 'expired', 'revised', 'issued', 'partially_paid', 'paid', 'partially_credited', 'credited', 'converted', 'void')),
	CONSTRAINT "documents_currency" CHECK("documents"."currency" in ('INR', 'USD')),
	CONSTRAINT "documents_supply_type" CHECK("documents"."supply_type" is null or "documents"."supply_type" in ('intra', 'inter', 'export_lut', 'export_igst')),
	CONSTRAINT "documents_numbered_when_frozen" CHECK(("documents"."frozen_at" is null and "documents"."number" is null) or ("documents"."frozen_at" is not null and "documents"."number" is not null and "documents"."number_display" is not null)),
	CONSTRAINT "documents_number_length" CHECK("documents"."number_display" is null or length("documents"."number_display") <= 16),
	CONSTRAINT "documents_void_reason" CHECK(("documents"."voided_at" is null) = ("documents"."void_reason" is null)),
	CONSTRAINT "documents_version" CHECK("documents"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `documents_series_fy_number` ON `documents` (`series`,`fy`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_number_display` ON `documents` (`series`,`number_display`) WHERE "documents"."number_display" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `documents_version` ON `documents` (`version_group_id`,`version`) WHERE "documents"."version_group_id" is not null;--> statement-breakpoint
CREATE INDEX `documents_client_type_status` ON `documents` (`client_id`,`type`,`status`);--> statement-breakpoint
CREATE INDEX `documents_status_due` ON `documents` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `documents_parent` ON `documents` (`parent_id`);--> statement-breakpoint
CREATE TABLE `payment_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`trigger` text NOT NULL,
	`pct_bp` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`milestone_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_schedules_trigger" CHECK("payment_schedules"."trigger" in ('on_accept', 'milestone', 'delivery', 'monthly')),
	CONSTRAINT "payment_schedules_pct" CHECK("payment_schedules"."pct_bp" between 0 and 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_schedules_position` ON `payment_schedules` (`document_id`,`position`);--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`offset_days` integer NOT NULL,
	`due_at` integer NOT NULL,
	`sent_at` integer,
	`email_log_id` text,
	`skipped_reason` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_document_offset` ON `reminders` (`document_id`,`offset_days`);--> statement-breakpoint
CREATE INDEX `reminders_due` ON `reminders` (`sent_at`,`due_at`);--> statement-breakpoint
CREATE TABLE `auth_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE TABLE `client_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`client_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`abs_expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `client_sessions_contact` ON `client_sessions` (`contact_id`);--> statement-breakpoint
CREATE TABLE `doc_access_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "doc_access_tokens_purpose" CHECK("doc_access_tokens"."purpose" in ('view_pay'))
);
--> statement-breakpoint
CREATE INDEX `doc_access_tokens_document` ON `doc_access_tokens` (`document_id`);--> statement-breakpoint
CREATE TABLE `magic_link_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`contact_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`request_ip` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `magic_link_tokens_contact` ON `magic_link_tokens` (`contact_id`);--> statement-breakpoint
CREATE TABLE `staff_invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`invited_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_invites_role" CHECK("staff_invites"."role" in ('owner', 'staff', 'sales', 'accountant'))
);
--> statement-breakpoint
CREATE INDEX `staff_invites_email` ON `staff_invites` (`email`);--> statement-breakpoint
CREATE TABLE `staff_recovery_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `staff_recovery_codes_user` ON `staff_recovery_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `staff_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`abs_expires_at` integer NOT NULL,
	`step_up_until` integer,
	`ip` text,
	`user_agent` text,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `staff_sessions_user` ON `staff_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`pw_salt` text,
	`pw_hmac` text,
	`pw_params` text,
	`totp_secret_enc` text,
	`totp_last_step` integer,
	`totp_enabled_at` integer,
	`last_login_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "staff_users_email_lower" CHECK("staff_users"."email" = lower("staff_users"."email")),
	CONSTRAINT "staff_users_role" CHECK("staff_users"."role" in ('owner', 'staff', 'sales', 'accountant')),
	CONSTRAINT "staff_users_status" CHECK("staff_users"."status" in ('invited', 'active', 'deactivated'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_users_email` ON `staff_users` (`email`);--> statement-breakpoint
CREATE TABLE `bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`account_name` text NOT NULL,
	`account_no` text NOT NULL,
	`ifsc` text,
	`swift` text,
	`bank_name` text NOT NULL,
	`branch` text,
	`bank_address` text,
	`intermediary` text,
	`active` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "bank_accounts_kind" CHECK("bank_accounts"."kind" in ('INR', 'USD_SWIFT'))
);
--> statement-breakpoint
CREATE TABLE `doc_counters` (
	`series` text NOT NULL,
	`fy` text NOT NULL,
	`next_no` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`series`, `fy`),
	CONSTRAINT "doc_counters_fy" CHECK("doc_counters"."fy" glob '[0-9][0-9][0-9][0-9]'),
	CONSTRAINT "doc_counters_next_no" CHECK("doc_counters"."next_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`pair` text NOT NULL,
	`rate_micros` integer NOT NULL,
	`source` text NOT NULL,
	`entered_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`entered_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fx_rates_rate" CHECK("fx_rates"."rate_micros" > 0),
	CONSTRAINT "fx_rates_source" CHECK("fx_rates"."source" in ('FBIL/RBI', 'manual'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fx_rates_pair_date_source` ON `fx_rates` (`pair`,`date`,`source`);--> statement-breakpoint
CREATE INDEX `fx_rates_date` ON `fx_rates` (`date`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settings_key" CHECK("settings"."key" in ('company', 'tax', 'numbering', 'payment_terms', 'email', 'retention', 'flags', 'gateways'))
);
--> statement-breakpoint
CREATE TABLE `terms_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` integer NOT NULL,
	`body_md` text NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "terms_versions_kind" CHECK("terms_versions"."kind" in ('proposal', 'invoice', 'website'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `terms_versions_kind_version` ON `terms_versions` (`kind`,`version`);