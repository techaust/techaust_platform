ALTER TABLE `payments` ADD `gateway_fee_inr_minor` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `gateway_fee_tax_inr_minor` integer;--> statement-breakpoint
CREATE INDEX `payments_proof_awaited` ON `payments` (`received_on`,`id`) WHERE "payments"."provider" in ('stripe', 'paypal') and "payments"."proof_r2_key" is null and "payments"."status" in ('pending_verification', 'confirmed');