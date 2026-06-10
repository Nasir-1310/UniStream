-- ╔══════════════════════════════════════════════════════════╗
-- ║          UniStream Saver — Supabase Schema              ║
-- ║  Run this in: Supabase Dashboard → SQL Editor → Run     ║
-- ╚══════════════════════════════════════════════════════════╝

-- 1. USERS table — whitelist control
CREATE TABLE IF NOT EXISTS public.users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   TEXT NOT NULL UNIQUE,   -- email or phone (normalized lowercase)
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('approved', 'pending', 'blocked')),
  name         TEXT,
  note         TEXT,                   -- admin notes (e.g. "CSE Batch 2024")
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 2. DOWNLOAD LOGS — for tracking & future analytics
CREATE TABLE IF NOT EXISTS public.download_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   TEXT NOT NULL,
  url          TEXT NOT NULL,
  title        TEXT,
  platform     TEXT,                   -- Youtube, Facebook, Instagram, TikTok
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_identifier   ON public.users (identifier);
CREATE INDEX IF NOT EXISTS idx_users_status       ON public.users (status);
CREATE INDEX IF NOT EXISTS idx_logs_identifier    ON public.download_logs (identifier);
CREATE INDEX IF NOT EXISTS idx_logs_created       ON public.download_logs (created_at DESC);

-- 4. Updated_at auto-trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON public.users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 5. Row Level Security — block direct public access
--    (API uses service role key which bypasses RLS)
ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.download_logs  ENABLE ROW LEVEL SECURITY;

-- No public policies — only service role (backend) can read/write

-- ── OPTIONAL: Seed your first approved admin user ─────────────────────────
-- INSERT INTO public.users (identifier, status, name, note)
-- VALUES ('youremail@gmail.com', 'approved', 'Admin', 'Super Admin');
