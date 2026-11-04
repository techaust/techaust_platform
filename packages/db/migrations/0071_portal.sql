CREATE TABLE `client_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`contact_id` text,
	`lead_id` text,
	`lead_ref` text,
	`contact_ref` text,
	`requester_email` text,
	`kind` text NOT NULL,
	`details` text,
	`status` text DEFAULT 'open' NOT NULL,
	`outcome` text,
	`closed_by` text,
	`closed_at` integer,
	`close_note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "client_requests_subject" CHECK("client_requests"."client_id" is not null or "client_requests"."lead_ref" is not null or "client_requests"."requester_email" is not null),
	CONSTRAINT "client_requests_refs" CHECK(("client_requests"."lead_ref" is null or length("client_requests"."lead_ref") between 1 and 64) and ("client_requests"."contact_ref" is null or length("client_requests"."contact_ref") between 1 and 64)),
	CONSTRAINT "client_requests_requester_email" CHECK("client_requests"."requester_email" is null or (length("client_requests"."requester_email") between 3 and 254 and "client_requests"."requester_email" = lower("client_requests"."requester_email"))),
	CONSTRAINT "client_requests_details_length" CHECK("client_requests"."details" is null or length("client_requests"."details") between 1 and 1000),
	CONSTRAINT "client_requests_close_note_length" CHECK("client_requests"."close_note" is null or length("client_requests"."close_note") between 1 and 500)
);
--> statement-breakpoint
CREATE INDEX `client_requests_client` ON `client_requests` (`client_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `client_requests_status` ON `client_requests` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_requests_open_kind` ON `client_requests` (`contact_id`,`kind`) WHERE "client_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX `client_requests_contact` ON `client_requests` (`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `client_requests_lead` ON `client_requests` (`lead_id`) WHERE "client_requests"."lead_id" is not null;--> statement-breakpoint
CREATE TABLE `payment_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`document_id` text NOT NULL,
	`contact_id` text,
	`via` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`paid_on` text NOT NULL,
	`reference` text NOT NULL,
	`reference_norm` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'open' NOT NULL,
	`payment_id` text,
	`closed_by` text,
	`closed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`closed_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payment_notices_amount" CHECK("payment_notices"."amount_minor" > 0),
	CONSTRAINT "payment_notices_currency" CHECK("payment_notices"."currency" in ('INR', 'USD')),
	CONSTRAINT "payment_notices_paid_on" CHECK(date("payment_notices"."paid_on") IS "payment_notices"."paid_on"),
	CONSTRAINT "payment_notices_reference_length" CHECK(length("payment_notices"."reference") between 1 and 64 and length("payment_notices"."reference_norm") between 1 and 60),
	CONSTRAINT "payment_notices_note_length" CHECK("payment_notices"."note" is null or length("payment_notices"."note") between 1 and 300)
);
--> statement-breakpoint
CREATE INDEX `payment_notices_document` ON `payment_notices` (`document_id`,`status`);--> statement-breakpoint
CREATE INDEX `payment_notices_status` ON `payment_notices` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payment_notices_open_reference` ON `payment_notices` (`document_id`,`reference_norm`) WHERE "payment_notices"."status" = 'open';--> statement-breakpoint
CREATE INDEX `payment_notices_client` ON `payment_notices` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `payment_notices_contact` ON `payment_notices` (`contact_id`) WHERE "payment_notices"."contact_id" is not null;--> statement-breakpoint
CREATE INDEX `payment_notices_payment` ON `payment_notices` (`payment_id`) WHERE "payment_notices"."payment_id" is not null;--> statement-breakpoint
CREATE INDEX `files_shared_project` ON `files` (`project_id`,`created_at`,`id`) WHERE "files"."shared" = 1;--> statement-breakpoint
CREATE INDEX `files_shared_client` ON `files` (`client_id`,`created_at`,`id`) WHERE "files"."shared" = 1;--> statement-breakpoint
CREATE INDEX `notes_shared_project` ON `notes` (`project_id`,`created_at`,`id`) WHERE "notes"."visibility" = 'shared';--> statement-breakpoint
CREATE INDEX `notes_shared_client` ON `notes` (`client_id`,`created_at`,`id`) WHERE "notes"."visibility" = 'shared';