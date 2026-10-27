CREATE TABLE `advance_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`proforma_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`client_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`received_on` text NOT NULL,
	`reference_norm` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`proforma_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "advance_receipts_currency" CHECK("advance_receipts"."currency" in ('INR', 'USD')),
	CONSTRAINT "advance_receipts_amount" CHECK("advance_receipts"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `advance_receipts_invoice_id_unique` ON `advance_receipts` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `advance_receipts_proforma_reference` ON `advance_receipts` (`proforma_id`,`reference_norm`);--> statement-breakpoint
CREATE INDEX `advance_receipts_client` ON `advance_receipts` (`client_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `documents` ADD `service_completed_on` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `export_declaration_id` text REFERENCES terms_blocks(id);--> statement-breakpoint
ALTER TABLE `bank_accounts` ADD `purpose_code` text;