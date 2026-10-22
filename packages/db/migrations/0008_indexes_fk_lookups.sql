CREATE INDEX `leads_client` ON `leads` (`client_id`);--> statement-breakpoint
CREATE INDEX `milestones_document` ON `milestones` (`document_id`);--> statement-breakpoint
CREATE INDEX `projects_owner` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE INDEX `acceptances_contact` ON `acceptances` (`contact_id`);--> statement-breakpoint
CREATE INDEX `approvals_document` ON `approvals` (`document_id`);--> statement-breakpoint
CREATE INDEX `documents_project` ON `documents` (`project_id`);--> statement-breakpoint
CREATE INDEX `documents_care_plan` ON `documents` (`care_plan_id`);