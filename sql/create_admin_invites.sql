-- ═══════════════════════════════════════════════════════════════════
--  CREATE ADMIN INVITES TABLE
--  Run in: Supabase Dashboard > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS admin_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  role         TEXT DEFAULT 'support' CHECK (role IN ('support', 'moderator', 'admin')),
  display_name TEXT NOT NULL,
  status       TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  accepted_at  TIMESTAMPTZ NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE admin_invites ENABLE ROW LEVEL SECURITY;

-- Allow Admins full access
DROP POLICY IF EXISTS "Admins full access admin_invites" ON admin_invites;
CREATE POLICY "Admins full access admin_invites" ON admin_invites FOR ALL USING (
  EXISTS (SELECT 1 FROM admins WHERE id = auth.uid())
);

-- Create index on email and status for fast lookup
CREATE INDEX IF NOT EXISTS idx_admin_invites_email ON admin_invites(email);
CREATE INDEX IF NOT EXISTS idx_admin_invites_status ON admin_invites(status);
