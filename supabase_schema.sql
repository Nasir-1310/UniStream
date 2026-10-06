-- ╔══════════════════════════════════════════════════════════════════════╗
-- ║  UniStream Saver — Supabase schema (v2, fresh install)               ║
-- ║  Run in: Supabase Dashboard → SQL Editor → New query → Run.          ║
-- ║                                                                      ║
-- ║  Upgrading a project that already has users or download logs? Run    ║
-- ║  supabase_migration_v2.sql instead: it keeps and backfills old data. ║
-- ╚══════════════════════════════════════════════════════════════════════╝

BEGIN;

SET LOCAL client_min_messages = warning;

-- ── 1. USERS — accounts, access status and daily download quota ─────────
CREATE TABLE IF NOT EXISTS public.users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier          text NOT NULL UNIQUE,          -- login key; the email for new accounts
  status              text NOT NULL DEFAULT 'pending'
                        CONSTRAINT users_status_check
                        CHECK (status IN ('approved', 'pending', 'blocked')),
  name                text,
  note                text,                          -- institution/department or admin note
  email               text,                          -- lowercase
  phone               text,                          -- E.164, e.g. +8801XXXXXXXXX
  password_hash       text,                          -- scrypt; never sent to clients
  temp_password       boolean NOT NULL DEFAULT false, -- true until the user picks their own
  daily_limit         integer
                        CONSTRAINT users_daily_limit_check
                        CHECK (daily_limit IS NULL OR daily_limit >= -1),
                                                     -- NULL = default setting, -1 = unlimited
  downloads_today     integer NOT NULL DEFAULT 0,    -- counter for usage_date
  usage_date          date,                          -- local (APP_TIMEZONE) day of downloads_today
  total_downloads     integer NOT NULL DEFAULT 0,
  approved_at         timestamptz,
  credentials_sent_at timestamptz,
  last_login_at       timestamptz,
  last_download_at    timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- ── 2. DOWNLOAD LOGS — one row per completed download ───────────────────
CREATE TABLE IF NOT EXISTS public.download_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  identifier  text NOT NULL,                         -- kept after the account is deleted
  url         text NOT NULL,
  title       text,
  platform    text,                                  -- YouTube, Facebook, Instagram
  quality     text,                                  -- e.g. "1080p MP4", "MP3"
  file_size   bigint,                                -- bytes
  created_at  timestamptz DEFAULT now()
);

-- ── 3. APP SETTINGS — values the admin can change at runtime ────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value)
VALUES ('default_daily_limit', '4')
ON CONFLICT (key) DO NOTHING;

-- ── 4. Indexes ──────────────────────────────────────────────────────────
-- Unique indexes allow many NULLs, so accounts without a phone are fine.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON public.users (email);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON public.users (phone);
CREATE INDEX IF NOT EXISTS idx_users_status    ON public.users (status);
CREATE INDEX IF NOT EXISTS idx_users_created   ON public.users (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_created    ON public.download_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_user       ON public.download_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_logs_platform   ON public.download_logs (platform);
CREATE INDEX IF NOT EXISTS idx_logs_identifier ON public.download_logs (identifier);

-- ── 5. updated_at trigger ───────────────────────────────────────────────
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

-- ── 6. Functions used by the backend ────────────────────────────────────
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

-- ── 7. Access: only the backend (service role) may touch this data ─────
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

-- Make the API see the new tables and functions immediately.
NOTIFY pgrst, 'reload schema';

-- Accounts are created from the app: users request access on the sign-in
-- page, or the admin adds them in the admin panel (which also generates and
-- emails a password). There is no need to insert users here.
