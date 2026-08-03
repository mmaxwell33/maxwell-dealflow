-- ─────────────────────────────────────────────────────────────────────────────
-- 085_email_link_clicks.sql
-- Click tracking for outgoing emails.
--
-- Every link in a sent email is stored here and the email's href is rewritten to
-- point at the track-click edge function, which logs the click and 302s to the
-- real URL. The URL is looked up BY ID rather than passed in the query string,
-- so the endpoint can never be abused as an open redirect for phishing.
--
-- Deliberately NOT an open-tracking pixel: Apple Mail Privacy Protection and
-- Gmail's image proxy pre-load images, so pixel "opens" are largely false
-- positives. A click is a real human action.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.email_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id         uuid NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  message_key      uuid NOT NULL,              -- ties links to one sent email
  recipient_email  text,
  url              text NOT NULL,
  label            text,                       -- link text, e.g. "Add to Calendar"
  click_count      integer NOT NULL DEFAULT 0,
  first_clicked_at timestamptz,
  last_clicked_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_links_msg_idx   ON public.email_links (message_key);
CREATE INDEX IF NOT EXISTS email_links_agent_idx ON public.email_links (agent_id, created_at DESC);

-- Correlate a sent email row with its links.
ALTER TABLE public.email_inbox ADD COLUMN IF NOT EXISTS message_key uuid;
CREATE INDEX IF NOT EXISTS email_inbox_msg_idx ON public.email_inbox (message_key);

ALTER TABLE public.email_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents read own email links"   ON public.email_links;
DROP POLICY IF EXISTS "Agents insert own email links" ON public.email_links;

CREATE POLICY "Agents read own email links"
  ON public.email_links FOR SELECT
  USING (agent_id = auth.uid());

CREATE POLICY "Agents insert own email links"
  ON public.email_links FOR INSERT
  WITH CHECK (agent_id = auth.uid());

-- Clicks are recorded by the edge function using the service role, which
-- bypasses RLS. No anon/public write policy is granted, so a recipient cannot
-- forge clicks or read anyone's links.
