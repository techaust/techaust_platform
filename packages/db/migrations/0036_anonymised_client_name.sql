-- Batch review fix, 07-Q Q2: "Anonymised client" replaces "Removed client". Only clients already anonymised and still carrying the old
-- label are touched (no table is rebuilt, no trigger is involved: the client triggers watch currency, type, gst_status and state_code).
-- Sent documents keep the names in their own frozen snapshots.
UPDATE `clients` SET `display_name` = 'Anonymised client', `legal_name` = CASE WHEN `legal_name` = 'Removed client' THEN 'Anonymised client' ELSE `legal_name` END WHERE `anonymised_at` IS NOT NULL AND `display_name` = 'Removed client';
