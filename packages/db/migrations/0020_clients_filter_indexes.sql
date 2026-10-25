CREATE INDEX `clients_gst_status_created` ON `clients` (`gst_status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `clients_currency_created` ON `clients` (`currency`,`created_at`,`id`);