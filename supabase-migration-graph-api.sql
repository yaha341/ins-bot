-- Add new columns for Graph API to ig_settings table

-- Add access_token column (replaces session for Graph API)
ALTER TABLE ig_settings
ADD COLUMN IF NOT EXISTS access_token text;

-- Add Instagram User ID (from Graph API)
ALTER TABLE ig_settings
ADD COLUMN IF NOT EXISTS ig_user_id text;

-- Keep existing columns:
-- id, username, session, is_connected, last_poll, last_error, updated_at

-- Note: session column will be kept for backward compatibility but not used with Graph API
