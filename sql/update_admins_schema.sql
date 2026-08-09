-- ═══════════════════════════════════════════════════════════════════
--  OPTIONAL: Add Profile Columns to admins Table
--  Run in: Supabase Dashboard > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
