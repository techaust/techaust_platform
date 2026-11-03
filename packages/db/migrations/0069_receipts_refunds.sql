CREATE TABLE `bank_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`target_kind` text NOT NULL,
	`payment_id` text,
	`settlement_id` text,
	`refund_id` text,
	`statement_on` text NOT NULL,
	`statement_ref` text,
	`matched_by` text NOT NULL,
	`matched_at` integer NOT NULL,
	`removed_by` text,
	`removed_at` integer,
	`remove_reason` text,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_id`) REFERENCES `payment_refunds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`matched_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "bank_matches_statement_on" CHECK(date("bank_matches"."statement_on") IS "bank_matches"."statement_on"),
	CONSTRAINT "bank_matches_statement_ref" CHECK("bank_matches"."statement_ref" is null or length("bank_matches"."statement_ref") between 1 and 64),
	CONSTRAINT "bank_matches_removed" CHECK(("bank_matches"."removed_by" is null and "bank_matches"."removed_at" is null and "bank_matches"."remove_reason" is null) or ("bank_matches"."removed_by" is not null and "bank_matches"."removed_at" is not null and length(trim("bank_matches"."remove_reason")) between 1 and 200))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bank_matches_payment` ON `bank_matches` (`payment_id`) WHERE "bank_matches"."payment_id" is not null and "bank_matches"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_matches_settlement` ON `bank_matches` (`settlement_id`) WHERE "bank_matches"."settlement_id" is not null and "bank_matches"."removed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `bank_matches_refund` ON `bank_matches` (`refund_id`) WHERE "bank_matches"."refund_id" is not null and "bank_matches"."removed_at" is null;--> statement-breakpoint
CREATE INDEX `bank_matches_matched_by` ON `bank_matches` (`matched_by`);--> statement-breakpoint
CREATE INDEX `bank_matches_removed_by` ON `bank_matches` (`removed_by`);--> statement-breakpoint
CREATE TABLE `payment_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`client_id` text NOT NULL,
	`document_id` text,
	`credit_note_id` text,
	`release_allocation_id` text,
	`provider` text NOT NULL,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`mode` text,
	`paid_to` text,
	`reason_code` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`inr_refunded_minor` integer,
	`reference_norm` text,
	`paid_on` text,
	`provider_refund_id` text,
	`provider_status` text,
	`failure_code` text,
	`note` text,
	`requested_by` text,
	`requested_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer,
	`settled_at` integer,
	`settled_on` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`credit_note_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_allocation_id`) REFERENCES `payment_allocations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_refunds_currency" CHECK("payment_refunds"."currency" in ('INR', 'USD')),
	CONSTRAINT "payment_refunds_amount" CHECK("payment_refunds"."amount_minor" > 0),
	CONSTRAINT "payment_refunds_inr_refunded" CHECK("payment_refunds"."inr_refunded_minor" is null or ("payment_refunds"."currency" = 'USD' and "payment_refunds"."inr_refunded_minor" > 0)),
	CONSTRAINT "payment_refunds_reference_length" CHECK("payment_refunds"."reference_norm" is null or length("payment_refunds"."reference_norm") between 1 and 60),
	CONSTRAINT "payment_refunds_paid_on" CHECK("payment_refunds"."paid_on" is null or date("payment_refunds"."paid_on") IS "payment_refunds"."paid_on"),
	CONSTRAINT "payment_refunds_settled_on" CHECK("payment_refunds"."settled_on" is null or date("payment_refunds"."settled_on") IS "payment_refunds"."settled_on"),
	CONSTRAINT "payment_refunds_provider_ref_length" CHECK("payment_refunds"."provider_refund_id" is null or length("payment_refunds"."provider_refund_id") between 1 and 255),
	CONSTRAINT "payment_refunds_provider_status_length" CHECK("payment_refunds"."provider_status" is null or length("payment_refunds"."provider_status") between 1 and 32),
	CONSTRAINT "payment_refunds_failure_code_length" CHECK("payment_refunds"."failure_code" is null or length("payment_refunds"."failure_code") between 1 and 64),
	CONSTRAINT "payment_refunds_note_length" CHECK("payment_refunds"."note" is null or length("payment_refunds"."note") <= 500),
	CONSTRAINT "payment_refunds_attempts" CHECK("payment_refunds"."attempts" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_refunds_open` ON `payment_refunds` (`payment_id`) WHERE "payment_refunds"."status" in ('requested', 'processing');--> statement-breakpoint
CREATE UNIQUE INDEX `payment_refunds_provider_ref` ON `payment_refunds` (`provider`,`provider_refund_id`) WHERE "payment_refunds"."provider_refund_id" is not null;--> statement-breakpoint
CREATE INDEX `payment_refunds_payment` ON `payment_refunds` (`payment_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_refunds_client` ON `payment_refunds` (`client_id`,`requested_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_refunds_document` ON `payment_refunds` (`document_id`);--> statement-breakpoint
CREATE INDEX `payment_refunds_credit_note` ON `payment_refunds` (`credit_note_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_refunds_release` ON `payment_refunds` (`release_allocation_id`) WHERE "payment_refunds"."release_allocation_id" is not null;--> statement-breakpoint
CREATE INDEX `payment_refunds_list` ON `payment_refunds` (`requested_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_refunds_status_list` ON `payment_refunds` (`status`,`requested_at`,`id`);--> statement-breakpoint
CREATE INDEX `payment_refunds_requested_by` ON `payment_refunds` (`requested_by`);--> statement-breakpoint
CREATE INDEX `payment_refunds_pending` ON `payment_refunds` (`last_attempt_at`,`id`) WHERE "payment_refunds"."status" in ('requested', 'processing');--> statement-breakpoint
CREATE INDEX `payment_refunds_settled` ON `payment_refunds` (`settled_on`,`id`) WHERE "payment_refunds"."status" = 'succeeded';--> statement-breakpoint
CREATE TABLE `realisation_reductions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`approved_on` text NOT NULL,
	`bank_ref` text NOT NULL,
	`declaration` integer DEFAULT 0 NOT NULL,
	`letter_r2_key` text,
	`letter_sha256` text,
	`letter_mime` text,
	`note` text,
	`recorded_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "realisation_reductions_currency" CHECK("realisation_reductions"."currency" in ('INR', 'USD')),
	CONSTRAINT "realisation_reductions_amount" CHECK("realisation_reductions"."amount_minor" > 0),
	CONSTRAINT "realisation_reductions_approved_on" CHECK(date("realisation_reductions"."approved_on") IS "realisation_reductions"."approved_on"),
	CONSTRAINT "realisation_reductions_bank_ref" CHECK(length("realisation_reductions"."bank_ref") between 1 and 64),
	CONSTRAINT "realisation_reductions_declaration" CHECK("realisation_reductions"."declaration" in (0, 1)),
	CONSTRAINT "realisation_reductions_letter" CHECK(("realisation_reductions"."letter_r2_key" is null and "realisation_reductions"."letter_sha256" is null and "realisation_reductions"."letter_mime" is null) or (length("realisation_reductions"."letter_r2_key") between 1 and 200 and length("realisation_reductions"."letter_sha256") = 64 and "realisation_reductions"."letter_mime" is not null)),
	CONSTRAINT "realisation_reductions_note_length" CHECK("realisation_reductions"."note" is null or length("realisation_reductions"."note") <= 500)
);
--> statement-breakpoint
CREATE INDEX `realisation_reductions_document` ON `realisation_reductions` (`document_id`,`approved_on`);--> statement-breakpoint
CREATE INDEX `realisation_reductions_recorded_by` ON `realisation_reductions` (`recorded_by`);--> statement-breakpoint
CREATE TABLE `settlement_items` (
	`id` text PRIMARY KEY NOT NULL,
	`settlement_id` text,
	`provider` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`fee_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`payment_id` text,
	`refund_id` text,
	`match` text NOT NULL,
	`fee_mismatch` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`settlement_id`) REFERENCES `settlements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_id`) REFERENCES `payment_refunds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "settlement_items_amounts" CHECK("settlement_items"."amount_minor" >= 0 and "settlement_items"."fee_minor" >= 0 and "settlement_items"."tax_minor" >= 0),
	CONSTRAINT "settlement_items_fee_mismatch" CHECK("settlement_items"."fee_mismatch" in (0, 1)),
	CONSTRAINT "settlement_items_entity_length" CHECK(length("settlement_items"."entity_id") between 1 and 255)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlement_items_entity` ON `settlement_items` (`provider`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `settlement_items_settlement` ON `settlement_items` (`settlement_id`);--> statement-breakpoint
CREATE INDEX `settlement_items_unmatched` ON `settlement_items` (`created_at`,`id`) WHERE "settlement_items"."match" = 'unmatched';--> statement-breakpoint
CREATE INDEX `settlement_items_payment` ON `settlement_items` (`payment_id`);--> statement-breakpoint
CREATE INDEX `settlement_items_refund` ON `settlement_items` (`refund_id`);--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`settlement_id` text NOT NULL,
	`utr` text,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`fees_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`settled_at` integer,
	`settled_on` text NOT NULL,
	`status` text,
	`fetched_at` integer NOT NULL,
	CONSTRAINT "settlements_currency" CHECK("settlements"."currency" in ('INR', 'USD')),
	CONSTRAINT "settlements_amounts" CHECK("settlements"."amount_minor" >= 0 and "settlements"."fees_minor" >= 0 and "settlements"."tax_minor" >= 0),
	CONSTRAINT "settlements_ref_length" CHECK(length("settlements"."settlement_id") between 1 and 64 and ("settlements"."utr" is null or length("settlements"."utr") between 1 and 64)),
	CONSTRAINT "settlements_settled_on" CHECK(date("settlements"."settled_on") IS "settlements"."settled_on"),
	CONSTRAINT "settlements_status_length" CHECK("settlements"."status" is null or length("settlements"."status") between 1 and 32)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_provider_ref` ON `settlements` (`provider`,`settlement_id`);--> statement-breakpoint
CREATE INDEX `settlements_settled` ON `settlements` (`settled_on`,`id`);--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_document_id` text REFERENCES documents(id);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_receipt` ON `payments` (`receipt_document_id`) WHERE "payments"."receipt_document_id" is not null;--> statement-breakpoint
CREATE INDEX `payments_receipt_due` ON `payments` (`verified_at`,`id`) WHERE "payments"."status" = 'confirmed' and "payments"."kind" = 'payment' and "payments"."receipt_document_id" is null;--> statement-breakpoint
CREATE INDEX `documents_receipt_pdf_pending` ON `documents` (`frozen_at`,`id`) WHERE "documents"."frozen_at" is not null and "documents"."pdf_sha256" is null and "documents"."type" = 'receipt';