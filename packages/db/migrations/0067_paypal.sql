CREATE TABLE `realisation_advice_payments` (
	`advice_id` text NOT NULL,
	`payment_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`removed_by` text,
	`removed_at` integer,
	`remove_reason` text,
	PRIMARY KEY(`advice_id`, `payment_id`),
	FOREIGN KEY (`advice_id`) REFERENCES `realisation_advices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`removed_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "realisation_advice_payments_removed" CHECK(("realisation_advice_payments"."removed_by" is null and "realisation_advice_payments"."removed_at" is null and "realisation_advice_payments"."remove_reason" is null) or ("realisation_advice_payments"."removed_by" is not null and "realisation_advice_payments"."removed_at" is not null and length(trim("realisation_advice_payments"."remove_reason")) between 1 and 200))
);
--> statement-breakpoint
CREATE INDEX `realisation_advice_payments_payment` ON `realisation_advice_payments` (`payment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `realisation_advice_payments_active` ON `realisation_advice_payments` (`payment_id`) WHERE "realisation_advice_payments"."removed_at" is null;--> statement-breakpoint
CREATE TABLE `realisation_advices` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`advice_ref` text NOT NULL,
	`issued_on` text NOT NULL,
	`period_from` text,
	`period_to` text,
	`inr_total_minor` integer,
	`file_r2_key` text,
	`file_sha256` text,
	`file_mime` text,
	`note` text,
	`recorded_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`recorded_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "realisation_advices_ref_length" CHECK(length("realisation_advices"."advice_ref") between 1 and 64),
	CONSTRAINT "realisation_advices_issued_on" CHECK(date("realisation_advices"."issued_on") IS "realisation_advices"."issued_on"),
	CONSTRAINT "realisation_advices_period" CHECK(("realisation_advices"."period_from" is null or date("realisation_advices"."period_from") IS "realisation_advices"."period_from") and ("realisation_advices"."period_to" is null or date("realisation_advices"."period_to") IS "realisation_advices"."period_to") and ("realisation_advices"."period_from" is null or "realisation_advices"."period_to" is null or "realisation_advices"."period_from" <= "realisation_advices"."period_to")),
	CONSTRAINT "realisation_advices_inr_total" CHECK("realisation_advices"."inr_total_minor" is null or "realisation_advices"."inr_total_minor" > 0),
	CONSTRAINT "realisation_advices_file" CHECK(("realisation_advices"."file_r2_key" is null and "realisation_advices"."file_sha256" is null and "realisation_advices"."file_mime" is null) or (length("realisation_advices"."file_r2_key") between 1 and 200 and length("realisation_advices"."file_sha256") = 64 and "realisation_advices"."file_mime" is not null)),
	CONSTRAINT "realisation_advices_note_length" CHECK("realisation_advices"."note" is null or length("realisation_advices"."note") <= 500)
);
--> statement-breakpoint
CREATE INDEX `realisation_advices_issued` ON `realisation_advices` (`issued_on`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `realisation_advices_ref` ON `realisation_advices` (`provider`,`kind`,`advice_ref`);--> statement-breakpoint
ALTER TABLE `checkout_sessions` ADD `provider_capture_id` text;--> statement-breakpoint
ALTER TABLE `checkout_sessions` ADD `capture_started_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_sessions_capture` ON `checkout_sessions` (`provider`,`provider_capture_id`) WHERE "checkout_sessions"."provider_capture_id" is not null;--> statement-breakpoint
CREATE INDEX `checkout_sessions_capture_pending` ON `checkout_sessions` (`updated_at`,`id`) WHERE "checkout_sessions"."status" = 'capture_pending';--> statement-breakpoint
CREATE INDEX `checkout_sessions_paypal_open` ON `checkout_sessions` (`expires_at`,`id`) WHERE "checkout_sessions"."provider" = 'paypal' and "checkout_sessions"."status" in ('live', 'stale');--> statement-breakpoint
CREATE INDEX `payments_confirmed_provider` ON `payments` (`provider`,`received_on`,`id`) WHERE "payments"."status" = 'confirmed' and "payments"."kind" = 'payment';