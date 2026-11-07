ALTER TABLE `payment_refunds` ADD `reversed_at` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_tried_at` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_fail_reason` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `receipt_fail_version` integer;--> statement-breakpoint
CREATE INDEX `payments_status_received` ON `payments` (`status`,`received_on`,`id`);