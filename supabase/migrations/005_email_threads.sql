-- 005_email_threads.sql
-- Add Gmail threading metadata to email_inbox for conversation view + reply

ALTER TABLE email_inbox ADD COLUMN IF NOT EXISTS gmail_thread_id text;
ALTER TABLE email_inbox ADD COLUMN IF NOT EXISTS gmail_message_id text;
ALTER TABLE email_inbox ADD COLUMN IF NOT EXISTS in_reply_to text;
ALTER TABLE email_inbox ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;
ALTER TABLE email_inbox ADD COLUMN IF NOT EXISTS gmail_internal_date timestamptz;

-- Index for fast thread grouping
CREATE INDEX IF NOT EXISTS idx_email_inbox_thread
  ON email_inbox(agent_id, gmail_thread_id);

-- Index for dedup when fetching from Gmail
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_inbox_message_id
  ON email_inbox(gmail_message_id) WHERE gmail_message_id IS NOT NULL;
