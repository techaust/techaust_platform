CREATE TABLE `pdf_repair_results` (
	`repair_id` text PRIMARY KEY NOT NULL,
	`original_key` text NOT NULL,
	`n` integer NOT NULL,
	`outcome` text NOT NULL,
	`code` text,
	`new_key` text,
	`new_sha256` text,
	`bytes` integer,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`repair_id`) REFERENCES `pdf_repairs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pdf_repair_results_outcome" CHECK("pdf_repair_results"."outcome" in ('rebuilt', 'intact', 'refused', 'failed', 'skipped')),
	CONSTRAINT "pdf_repair_results_code" CHECK("pdf_repair_results"."code" is null or ("pdf_repair_results"."code" glob '[a-z_]*' and length("pdf_repair_results"."code") between 1 and 40)),
	CONSTRAINT "pdf_repair_results_rebuilt" CHECK(("pdf_repair_results"."outcome" = 'rebuilt') = ("pdf_repair_results"."new_key" is not null and "pdf_repair_results"."new_sha256" is not null)),
	CONSTRAINT "pdf_repair_results_new_key" CHECK("pdf_repair_results"."new_key" is null or (length("pdf_repair_results"."new_key") between 6 and 512 and (substr("pdf_repair_results"."new_key", 1, 5) = 'docs/' or substr("pdf_repair_results"."new_key", 1, 6) = 'deeds/'))),
	CONSTRAINT "pdf_repair_results_new_sha256" CHECK("pdf_repair_results"."new_sha256" is null or (length("pdf_repair_results"."new_sha256") = 64 and not "pdf_repair_results"."new_sha256" glob '*[^0-9a-f]*')),
	CONSTRAINT "pdf_repair_results_bytes" CHECK("pdf_repair_results"."bytes" is null or "pdf_repair_results"."bytes" >= 1)
);
--> statement-breakpoint
CREATE INDEX `pdf_repair_results_served` ON `pdf_repair_results` (`original_key`,`n`) WHERE "pdf_repair_results"."outcome" = 'rebuilt';--> statement-breakpoint
CREATE TABLE `pdf_repairs` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`n` integer NOT NULL,
	`original_key` text NOT NULL,
	`old_key` text NOT NULL,
	`old_sha256` text,
	`found` text NOT NULL,
	`new_key` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	FOREIGN KEY (`requested_by`) REFERENCES `staff_users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pdf_repairs_kind" CHECK("pdf_repairs"."subject_kind" in ('offer', 'certificate', 'deed', 'invoice', 'supplier', 'receipt')),
	CONSTRAINT "pdf_repairs_found" CHECK("pdf_repairs"."found" in ('missing', 'damaged')),
	CONSTRAINT "pdf_repairs_n" CHECK("pdf_repairs"."n" between 1 and 99),
	CONSTRAINT "pdf_repairs_subject_id" CHECK(length("pdf_repairs"."subject_id") between 1 and 64),
	CONSTRAINT "pdf_repairs_original_key" CHECK(length("pdf_repairs"."original_key") between 6 and 512 and (substr("pdf_repairs"."original_key", 1, 5) = 'docs/' or substr("pdf_repairs"."original_key", 1, 6) = 'deeds/')),
	CONSTRAINT "pdf_repairs_old_key" CHECK(length("pdf_repairs"."old_key") between 6 and 512 and (substr("pdf_repairs"."old_key", 1, 5) = 'docs/' or substr("pdf_repairs"."old_key", 1, 6) = 'deeds/')),
	CONSTRAINT "pdf_repairs_new_key_shape" CHECK(length("pdf_repairs"."new_key") between 6 and 512 and (substr("pdf_repairs"."new_key", 1, 5) = 'docs/' or substr("pdf_repairs"."new_key", 1, 6) = 'deeds/')),
	CONSTRAINT "pdf_repairs_old_sha256" CHECK("pdf_repairs"."old_sha256" is null or (length("pdf_repairs"."old_sha256") = 64 and not "pdf_repairs"."old_sha256" glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pdf_repairs_new_key` ON `pdf_repairs` (`new_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `pdf_repairs_subject_n` ON `pdf_repairs` (`subject_kind`,`subject_id`,`n`);--> statement-breakpoint
CREATE INDEX `pdf_repairs_requested_by` ON `pdf_repairs` (`requested_by`);