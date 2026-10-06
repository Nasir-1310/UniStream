-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  UniStream Saver — database upgrade v2                               ║
-- ║  Accounts with passwords, daily download limits and admin tools.      ║
-- ║                                                                      ║
-- ║  Run once in: Supabase Dashboard → SQL Editor → New query → Run.     ║
-- ║  Safe to run again: every step checks what already exists, keeps     ║
-- ║  all users and download logs, and finishes in one transaction.       ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

-- Re-runs would otherwise print a notice for every existing object.
SET LOCAL client_min_messages = warning;

-- ── 1. Tables (created only when missing) ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.download_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL,
  url         text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── 2. New columns ──────────────────────────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS name                text,
  ADD COLUMN IF NOT EXISTS note                text,
  ADD COLUMN IF NOT EXISTS email               text,
  ADD COLUMN IF NOT EXISTS phone               text,
  ADD COLUMN IF NOT EXISTS password_hash       text,
  ADD COLUMN IF NOT EXISTS temp_password       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS daily_limit         integer,
  ADD COLUMN IF NOT EXISTS downloads_today     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usage_date          date,
  ADD COLUMN IF NOT EXISTS total_downloads     integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  ADD COLUMN IF NOT EXISTS credentials_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_login_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_download_at    timestamptz,
  ADD COLUMN IF NOT EXISTS created_at          timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at          timestamptz DEFAULT now();

ALTER TABLE public.download_logs
  ADD COLUMN IF NOT EXISTS title      text,
  ADD COLUMN IF NOT EXISTS platform   text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS user_id    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quality    text,
  ADD COLUMN IF NOT EXISTS file_size  bigint;

-- daily_limit: NULL = the default limit from app_settings, -1 = unlimited.
-- The status check is NOT VALID so unexpected legacy values cannot block
-- the upgrade; it is still enforced for every new or changed row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass AND conname = 'users_status_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('approved', 'pending', 'blocked')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.users'::regclass AND conname = 'users_daily_limit_check'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_daily_limit_check
      CHECK (daily_limit IS NULL OR daily_limit >= -1);
  END IF;
END
$$;

-- ── 3. Backfill legacy accounts (they signed in with an email or phone) ─
-- Approved legacy accounts were approved before approved_at existed. This
-- runs first because the updated_at trigger rewrites updated_at on every
-- later backfill.
UPDATE public.users
   SET approved_at = coalesce(updated_at, created_at, now())
 WHERE status = 'approved'
   AND approved_at IS NULL;

-- Several legacy identifiers can map to the same address or number (e.g.
-- 017… and +88017…); only one row may own it, preferring approved accounts
-- and then the oldest, and never one that another row already owns.
WITH candidates AS (
  SELECT id,
         lower(btrim(identifier)) AS new_email,
         row_number() OVER (
           PARTITION BY lower(btrim(identifier))
           ORDER BY (status = 'approved') DESC, created_at ASC NULLS LAST, id
         ) AS rank
    FROM public.users
   WHERE email IS NULL
     AND identifier LIKE '%@%'
)
UPDATE public.users AS u
   SET email = c.new_email
  FROM candidates AS c
 WHERE u.id = c.id
   AND c.rank = 1
   AND NOT EXISTS (SELECT 1 FROM public.users AS o WHERE o.email = c.new_email);

WITH mapped AS (
  SELECT id, status, created_at,
         CASE
           WHEN btrim(identifier) ~ '^01[3-9][0-9]{8}$'
             THEN '+880' || substring(btrim(identifier) FROM 2)
           WHEN btrim(identifier) ~ '^8801[3-9][0-9]{8}$'
             THEN '+' || btrim(identifier)
           WHEN btrim(identifier) ~ '^\+8801[3-9][0-9]{8}$'
             THEN btrim(identifier)
         END AS new_phone
    FROM public.users
   WHERE phone IS NULL
),
candidates AS (
  SELECT id, new_phone,
         row_number() OVER (
           PARTITION BY new_phone
           ORDER BY (status = 'approved') DESC, created_at ASC NULLS LAST, id
         ) AS rank
    FROM mapped
   WHERE new_phone IS NOT NULL
)
UPDATE public.users AS u
   SET phone = c.new_phone
  FROM candidates AS c
 WHERE u.id = c.id
   AND c.rank = 1
   AND NOT EXISTS (SELECT 1 FROM public.users AS o WHERE o.phone = c.new_phone);

-- Lifetime totals from the existing audit log. Legacy rows without a title
-- were duplicate "file sent" entries, so only titled rows count. Runs only
-- for accounts that have not downloaded since the upgrade.
UPDATE public.users AS u
   SET total_downloads = s.completed,
       last_download_at = s.last_at
  FROM (
    SELECT identifier,
           count(*) FILTER (WHERE coalesce(title, '') <> '') AS completed,
           max(created_at) AS last_at
      FROM public.download_logs
     GROUP BY identifier
  ) AS s
 WHERE s.identifier = u.identifier
   AND u.last_download_at IS NULL
   AND u.total_downloads = 0;

-- Link legacy log rows to their accounts so the admin can filter by user.
UPDATE public.download_logs AS l
   SET user_id = u.id
  FROM public.users AS u
 WHERE l.user_id IS NULL
   AND u.identifier = l.identifier;

-- Legacy rows stored yt-dlp extractor names ("Youtube", "FacebookReel", "")
-- instead of the platform labels used by filters and statistics.
WITH mapped AS (
  SELECT id,
         CASE
           WHEN lower(coalesce(platform, '')) LIKE 'youtube%' THEN 'YouTube'
           WHEN lower(coalesce(platform, '')) LIKE 'facebook%' THEN 'Facebook'
           WHEN lower(coalesce(platform, '')) LIKE 'instagram%' THEN 'Instagram'
           WHEN url ~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be|youtube-nocookie\.com)([/?#:]|$)'
             THEN 'YouTube'
           WHEN url ~* '^https?://([a-z0-9-]+\.)*(facebook\.com|fb\.watch|fb\.com)([/?#:]|$)'
             THEN 'Facebook'
           WHEN url ~* '^https?://([a-z0-9-]+\.)*(instagram\.com|instagr\.am)([/?#:]|$)'
             THEN 'Instagram'
         END AS label
    FROM public.download_logs
   WHERE platform IS NULL
      OR platform NOT IN ('YouTube', 'Facebook', 'Instagram')
)
UPDATE public.download_logs AS l
   SET platform = m.label
  FROM mapped AS m
 WHERE l.id = m.id
   AND m.label IS NOT NULL;

-- ── 4. Indexes ──────────────────────────────────────────────────────────
-- Unique indexes allow many NULLs, so accounts without a phone are fine.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON public.users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON public.users (phone);
CREATE INDEX IF NOT EXISTS idx_users_status   ON public.users (status);
CREATE INDEX IF NOT EXISTS idx_users_created  ON public.users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created   ON public.download_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_user      ON public.download_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_platform  ON public.download_logs (platform);
CREATE INDEX IF NOT EXISTS idx_logs_identifier ON public.download_logs (identifier);

-- ── 5. Settings ─────────────────────────────────────────────────────────
INSERT INTO public.app_settings (key, value)
VALUES ('default_daily_limit', '4')
ON CONFLICT (key) DO NOTHING;

-- ── 6. updated_at trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 7. Functions used by the backend ────────────────────────────────────
-- One atomic statement, so parallel downloads can never lose a count. The
-- day rolls over when p_today (the app's local date) differs from usage_date.
CREATE OR REPLACE FUNCTION public.record_user_download(p_user_id uuid, p_today date)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  UPDATE public.users
     SET downloads_today  = CASE WHEN usage_date = p_today THEN downloads_today + 1 ELSE 1 END,
         usage_date       = p_today,
         total_downloads  = total_downloads + 1,
         last_download_at = now()
   WHERE id = p_user_id
  RETURNING downloads_today;
$$;

-- Daily downloads per platform, bucketed by the app's local calendar day.
CREATE OR REPLACE FUNCTION public.download_stats(p_since timestamptz, p_tz text)
RETURNS TABLE (day date, platform text, downloads bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT (l.created_at AT TIME ZONE p_tz)::date,
         coalesce(l.platform, ''),
         count(*)
    FROM public.download_logs AS l
   WHERE l.created_at >= p_since
   GROUP BY 1, 2
   ORDER BY 1, 2;
$$;

-- ── 8. Access: only the backend (service role) may touch this data ─────
REVOKE EXECUTE ON FUNCTION public.record_user_download(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.download_stats(timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_download(uuid, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.download_stats(timestamptz, text) TO service_role;

REVOKE ALL ON TABLE public.users, public.download_logs, public.app_settings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
   ON TABLE public.users, public.download_logs, public.app_settings TO service_role;

-- Row Level Security with no policies: the public API keys see nothing.
ALTER TABLE public.users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings  ENABLE ROW LEVEL SECURITY;

COMMIT;

-- Make the API see the new columns and functions immediately.
NOTIFY pgrst, 'reload schema';
