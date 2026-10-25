CREATE INDEX `catalogue_items_filters` ON `catalogue_items` (`category`,`active`,`show_on_site`);--> statement-breakpoint
CREATE INDEX `catalogue_items_name_nocase` ON `catalogue_items` ("name" collate nocase);--> statement-breakpoint
CREATE UNIQUE INDEX `site_snapshots_sha256` ON `site_snapshots` (`sha256`);