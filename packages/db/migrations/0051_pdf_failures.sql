CREATE TABLE `pdf_failures` (
	`document_id` text PRIMARY KEY NOT NULL,
	`nights` integer DEFAULT 0 NOT NULL,
	`last_failed_day` text,
	`last_attempt_at` integer,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pdf_failures_nights" CHECK("pdf_failures"."nights" >= 0)
);
