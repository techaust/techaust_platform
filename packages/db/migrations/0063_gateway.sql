CREATE TABLE `checkout_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`document_id` text NOT NULL,
	`client_id` text NOT NULL,
	`contact_id` text,
	`doc_token_id` text,
	`created_by` text,
	`source` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`status` text NOT NULL,
	`provider_link_id` text,
	`short_url` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`last_refresh_at` integer,
	`paid_payment_id` text,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`doc_token_id`) REFERENCES `doc_access_tokens`(`token_hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "checkout_sessions_currency" CHECK("checkout_sessions"."currency" in ('INR', 'USD')),
	CONSTRAINT "checkout_sessions_amount" CHECK("checkout_sessions"."amount_minor" > 0),
	CONSTRAINT "checkout_sessions_provider_link_length" CHECK("checkout_sessions"."provider_link_id" is null or length("checkout_sessions"."provider_link_id") between 1 and 255),
	CONSTRAINT "checkout_sessions_short_url" CHECK("checkout_sessions"."short_url" is null or (length("checkout_sessions"."short_url") between 1 and 5000 and "checkout_sessions"."short_url" like 'https://%'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_sessions_open` ON `checkout_sessions` (`document_id`) WHERE "checkout_sessions"."status" in ('creating', 'live');--> statement-breakpoint
CREATE UNIQUE INDEX `checkout_sessions_provider_link` ON `checkout_sessions` (`provider`,`provider_link_id`) WHERE "checkout_sessions"."provider_link_id" is not null;--> statement-breakpoint
CREATE INDEX `checkout_sessions_client` ON `checkout_sessions` (`client_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `checkout_sessions_document` ON `checkout_sessions` (`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `checkout_sessions_contact` ON `checkout_sessions` (`contact_id`);--> statement-breakpoint
CREATE TABLE `hook_failures` (
	`key` text PRIMARY KEY NOT NULL,
	`window_start` integer NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "hook_failures_count" CHECK("hook_failures"."count" between 0 and 50)
);
--> statement-breakpoint
CREATE TABLE `review_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`webhook_event_id` text,
	`payment_id` text,
	`document_id` text,
	`client_id` text,
	`amount_minor` integer,
	`currency` text,
	`facts` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	`resolution` text,
	`note` text,
	FOREIGN KEY (`webhook_event_id`) REFERENCES `webhook_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_items_amount" CHECK("review_items"."amount_minor" is null or "review_items"."amount_minor" > 0),
	CONSTRAINT "review_items_currency" CHECK("review_items"."currency" is null or "review_items"."currency" in ('INR', 'USD')),
	CONSTRAINT "review_items_facts" CHECK("review_items"."facts" is null or (json_valid("review_items"."facts") and json_type("review_items"."facts") = 'object' and length("review_items"."facts") <= 2000)),
	CONSTRAINT "review_items_note_length" CHECK("review_items"."note" is null or length("review_items"."note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_items_event_kind` ON `review_items` (`webhook_event_id`,`kind`) WHERE "review_items"."webhook_event_id" is not null;--> statement-breakpoint
CREATE INDEX `review_items_payment` ON `review_items` (`payment_id`);--> statement-breakpoint
CREATE INDEX `review_items_client` ON `review_items` (`client_id`);--> statement-breakpoint
CREATE INDEX `review_items_status` ON `review_items` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `review_items_document` ON `review_items` (`document_id`);--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_id` text NOT NULL,
	`event_type` text NOT NULL,
	`received_at` integer NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`processed_at` integer,
	`outcome` text,
	`facts` text,
	CONSTRAINT "webhook_events_event_id" CHECK(length("webhook_events"."event_id") between 1 and 255),
	CONSTRAINT "webhook_events_event_type" CHECK(length("webhook_events"."event_type") between 1 and 64),
	CONSTRAINT "webhook_events_attempts" CHECK("webhook_events"."attempts" >= 0),
	CONSTRAINT "webhook_events_outcome" CHECK("webhook_events"."outcome" is null or length("webhook_events"."outcome") between 1 and 64),
	CONSTRAINT "webhook_events_facts" CHECK("webhook_events"."facts" is null or (json_valid("webhook_events"."facts") and json_type("webhook_events"."facts") = 'object' and length("webhook_events"."facts") <= 2000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_events_provider_event` ON `webhook_events` (`provider`,`event_id`);--> statement-breakpoint
CREATE INDEX `webhook_events_received` ON `webhook_events` (`received_at`,`id`) WHERE "webhook_events"."status" = 'received';--> statement-breakpoint
ALTER TABLE `payments` ADD `provider_payment_id` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `checkout_id` text REFERENCES checkout_sessions(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `fee_tax_minor` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `refetched_at` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `webhook_event_id` text REFERENCES webhook_events(id);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_provider_ref` ON `payments` (`provider`,`provider_payment_id`) WHERE "payments"."provider_payment_id" is not null;