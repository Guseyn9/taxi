-- Migration 007 has been merged into 006_command_api.sql.
--
-- Previously this file added the `status` column and its index in a
-- non-idempotent way. Both changes are now part of 006_command_api.sql and are
-- applied with INFORMATION_SCHEMA guards, so re-running the migration script
-- never fails with "Duplicate column" or "Duplicate key".
--
-- This file is intentionally empty (kept for backward compatibility with
-- deployment scripts that reference migration 007 by filename).
SELECT 1;
