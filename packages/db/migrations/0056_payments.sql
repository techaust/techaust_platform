CREATE TABLE `payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`document_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`kind` text NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_allocations_amount" CHECK("payment_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `payment_allocations_payment` ON `payment_allocations` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payment_allocations_document` ON `payment_allocations` (`document_id`,`payment_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`charges_minor` integer DEFAULT 0 NOT NULL,
	`received_on` text NOT NULL,
	`mode` text,
	`reference_norm` text,
	`inr_received_minor` integer,
	`requested_allocations` text,
	`tds_section` text,
	`tds_rate_bp` integer,
	`tds_certificate_no` text,
	`tds_certificate_on` text,
	`proof_kind` text,
	`proof_ref` text,
	`proof_r2_key` text,
	`proof_sha256` text,
	`proof_mime` text,
	`advance_receipt_id` text,
	`note` text,
	`recorded_by` text,
	`recorded_at` integer NOT NULL,
	`verified_by` text,
	`verified_at` integer,
	`decision_note` text,
	`withdrawn_by` text,
	`withdrawn_at` integer,
	`withdraw_reason` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`advance_receipt_id`) REFERENCES `advance_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`withdrawn_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_currency" CHECK("payments"."currency" in ('INR', 'USD')),
	CONSTRAINT "payments_amount" CHECK("payments"."amount_minor" > 0),
	CONSTRAINT "payments_charges" CHECK("payments"."charges_minor" >= 0),
	CONSTRAINT "payments_received_on" CHECK(date("payments"."received_on") IS "payments"."received_on"),
	CONSTRAINT "payments_reference_length" CHECK("payments"."reference_norm" is null or length("payments"."reference_norm") between 1 and 60),
	CONSTRAINT "payments_inr_received" CHECK("payments"."inr_received_minor" is null or ("payments"."currency" = 'USD' and "payments"."inr_received_minor" > 0)),
	CONSTRAINT "payments_requested_allocations" CHECK("payments"."requested_allocations" is null or (json_valid("payments"."requested_allocations") and json_type("payments"."requested_allocations") = 'array' and json_array_length("payments"."requested_allocations") between 1 and 10)),
	CONSTRAINT "payments_tds_certificate_on" CHECK("payments"."tds_certificate_on" is null or date("payments"."tds_certificate_on") IS "payments"."tds_certificate_on"),
	CONSTRAINT "payments_note_length" CHECK("payments"."note" is null or length("payments"."note") <= 500)
);
--> statement-breakpoint
CREATE INDEX `payments_client` ON `payments` (`client_id`,`currency`,`received_on`,`id`);--> statement-breakpoint
CREATE INDEX `payments_pending` ON `payments` (`recorded_at`,`id`) WHERE "payments"."status" = 'pending_verification';--> statement-breakpoint
CREATE INDEX `payments_confirmed` ON `payments` (`received_on`,`id`) WHERE "payments"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX `payments_reference` ON `payments` (`reference_norm`) WHERE "payments"."reference_norm" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `payments_advance_receipt` ON `payments` (`advance_receipt_id`) WHERE "payments"."advance_receipt_id" is not null;--> statement-breakpoint
CREATE TABLE `realisation_extensions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`extended_to` text NOT NULL,
	`bank_ref` text NOT NULL,
	`letter_r2_key` text,
	`letter_sha256` text,
	`letter_mime` text,
	`recorded_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "realisation_extensions_extended_to" CHECK(date("realisation_extensions"."extended_to") IS "realisation_extensions"."extended_to"),
	CONSTRAINT "realisation_extensions_bank_ref" CHECK(length("realisation_extensions"."bank_ref") between 1 and 64)
);
--> statement-breakpoint
CREATE INDEX `realisation_extensions_document` ON `realisation_extensions` (`document_id`,`extended_to`);--> statement-breakpoint
ALTER TABLE `documents` ADD `tds_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_payment_pending` ON `approvals` (`payment_id`) WHERE "approvals"."status" = 'pending' and "approvals"."kind" = 'payment_verify';