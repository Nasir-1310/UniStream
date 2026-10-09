-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  UniStream Saver — feedback and problem reports                      ║
-- ║                                                                      ║
-- ║  Run once in: Supabase Dashboard → SQL Editor → New query → Run.     ║
-- ║  Safe to run again. Until it has run, the rest of the site works;    ║
-- ║  only "Report a problem / Send feedback" says it isn't set up yet.   ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

SET LOCAL client_min_messages = warning;

CREATE TABLE IF NOT EXISTS public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  identifier  text NOT NULL DEFAULT '',
  kind        text NOT NULL CHECK (kind IN ('problem', 'feedback', 'idea')),
  message     text NOT NULL,
  url         text,
  details     text,
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'done')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_created ON public.feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_status  ON public.feedback (status);

-- Row Level Security with no policies: the public API keys see nothing.
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Make the new table visible to the API right away.
NOTIFY pgrst, 'reload schema';
