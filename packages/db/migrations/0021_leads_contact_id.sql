ALTER TABLE `leads` ADD `contact_id` text REFERENCES contacts(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `leads_contact` ON `leads` (`contact_id`);