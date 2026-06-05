ALTER TABLE deployments
  ADD COLUMN events_queue_arn TEXT;

ALTER TABLE functions
  ADD COLUMN invoke_queue_arn TEXT,
  ADD COLUMN invoke_esm_uuid TEXT;
