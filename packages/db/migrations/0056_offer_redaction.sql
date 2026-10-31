ALTER TABLE `document_lines` ADD `redacted_at` integer;--> statement-breakpoint
ALTER TABLE `document_sections` ADD `redacted_at` integer;--> statement-breakpoint
ALTER TABLE `documents` ADD `redacted_at` integer;--> statement-breakpoint
ALTER TABLE `payment_schedules` ADD `redacted_at` integer;