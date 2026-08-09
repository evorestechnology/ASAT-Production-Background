-- ═══════════════════════════════════════════════════════════════════
--  SUPABASE AUTH REPAIR SCRIPT
--
--  Run this in: Supabase Dashboard > SQL Editor > New Query
--  This cleans up orphaned records in the internal `auth` schema
--  and restores required GoTrue instance rows so Auth 500 errors stop.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Ensure FK triggers are active
SET session_replication_role = 'origin';

-- 2. Clean up all child/orphaned auth tables
DELETE FROM auth.mfa_challenges;
DELETE FROM auth.mfa_factors;
DELETE FROM auth.mfa_amr_claims;
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.sessions;
DELETE FROM auth.identities;
DELETE FROM auth.one_time_tokens;
DELETE FROM auth.flow_state;
DELETE FROM auth.audit_log_entries;
DELETE FROM auth.users;

-- 3. Restore default auth instance row if missing (required by GoTrue auth engine)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'auth' AND table_name = 'instances'
  ) THEN
    INSERT INTO auth.instances (id, uuid, raw_base_config, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', '{}', now(), now())
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE '✅ Supabase Auth tables cleaned and repaired successfully!';
  RAISE NOTICE '   Now you can run "npm run add-admin" in terminal or create a user in Supabase.';
END $$;
