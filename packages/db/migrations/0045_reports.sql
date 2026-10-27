CREATE TABLE `statement_pdfs` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`currency` text NOT NULL,
	`from_date` text NOT NULL,
	`to_date` text NOT NULL,
	`issuer` text NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`view_sha256` text,
	`pdf_r2_key` text,
	`pdf_sha256` text,
	`rendered_at` integer,
	`failed_at` integer,
	`fail_code` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "statement_pdfs_currency" CHECK("statement_pdfs"."currency" in ('INR', 'USD')),
	CONSTRAINT "statement_pdfs_range" CHECK(date("statement_pdfs"."from_date") is "statement_pdfs"."from_date" and date("statement_pdfs"."to_date") is "statement_pdfs"."to_date" and "statement_pdfs"."from_date" <= "statement_pdfs"."to_date")
);
--> statement-breakpoint
CREATE INDEX `statement_pdfs_client` ON `statement_pdfs` (`client_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `statement_pdfs_created` ON `statement_pdfs` (`created_at`);--> statement-breakpoint
CREATE INDEX `advance_receipts_client_received` ON `advance_receipts` (`client_id`,`received_on`,`id`);--> statement-breakpoint
CREATE INDEX `documents_issued_on` ON `documents` (`issue_date`,`id`) WHERE "documents"."frozen_at" is not null and "documents"."type" in ('tax_invoice', 'export_invoice', 'credit_note', 'debit_note');--> statement-breakpoint
CREATE INDEX `documents_export_issued` ON `documents` (`issue_date`,`id`) WHERE "documents"."frozen_at" is not null and "documents"."type" = 'export_invoice';--> statement-breakpoint
CREATE INDEX `documents_client_issued` ON `documents` (`client_id`,`issue_date`,`id`) WHERE "documents"."frozen_at" is not null and "documents"."type" in ('tax_invoice', 'export_invoice', 'credit_note', 'debit_note');