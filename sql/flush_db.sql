-- ═══════════════════════════════════════════════════════════════════
--  ASAT FULL DATABASE FLUSH SCRIPT
--  Wipes EVERYTHING:
--    * All application table data
--    * All uploaded storage files (asat-uploads bucket)
--    * All Supabase auth users (login credentials)
--
--  WARNING: THIS IS COMPLETELY IRREVERSIBLE.
--  ALL DATA, FILES, AND ACCOUNTS WILL BE PERMANENTLY LOST.
--  Run in: Supabase Dashboard > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'ASAT FULL FLUSH: All data, storage files, and auth users will be deleted.';
END $$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 1: Disable all FK triggers so we can TRUNCATE in any order
-- ════════════════════════════════════════════════════════════════════
SET session_replication_role = 'replica';


-- ════════════════════════════════════════════════════════════════════
--  STEP 2: Safe-truncate every application table
--  Uses information_schema to skip tables that don't exist yet.
-- ════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t TEXT;
  tables_to_flush TEXT[] := ARRAY[
    'ticket_messages',
    'tickets',
    'withdrawals',
    'wallets',
    'orders',
    'designs',
    'print_styles',
    'products',
    'user_addresses',
    'admin_invites',
    'otps',
    'catalogue',
    'categories',
    'manufacturers',
    'designers',
    'admins',
    'users',
    'settings'
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_flush LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = t
    ) THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
      RAISE NOTICE 'Truncated: %', t;
    ELSE
      RAISE NOTICE 'Skipped (does not exist): %', t;
    END IF;
  END LOOP;
END $$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 3: Re-enable FK triggers
-- ════════════════════════════════════════════════════════════════════
SET session_replication_role = 'origin';


-- ════════════════════════════════════════════════════════════════════
--  STEP 4: Re-seed essential default data
-- ════════════════════════════════════════════════════════════════════

-- Restore the platform earnings settings row (required for order processing)
INSERT INTO settings (key, value)
VALUES ('earnings', '{"designer": 30, "mfg": 40, "platform": 30}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();


-- ════════════════════════════════════════════════════════════════════
--  STEP 5: Storage files — MUST be deleted via Supabase Dashboard
--
--  Supabase blocks direct SQL deletes on storage.objects via a trigger.
--  To delete all uploaded files:
--
--    Option A (Dashboard - easiest):
--      1. Go to: Supabase Dashboard > Storage > asat-uploads
--      2. Click the three-dot menu > Empty Bucket
--      (or Select All files and click Delete)
--
--    Option B (run flush_storage.js from your backend):
--      node backend/sql/flush_storage.js
--
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'STEP 5: Storage files must be cleared via Supabase Dashboard or flush_storage.js';
  RAISE NOTICE '  Dashboard > Storage > asat-uploads > Empty Bucket';
END $$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 6: Delete ALL Supabase Auth users
--
--  Removes every auth account. All designers, manufacturers, customers,
--  and admins must re-register from scratch.
--
--  If this fails with a permissions error, go to:
--    Dashboard > Authentication > Users > Select All > Delete
-- ════════════════════════════════════════════════════════════════════
DELETE FROM auth.users;


-- ════════════════════════════════════════════════════════════════════
--  DONE
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'ASAT SQL flush complete.';
  RAISE NOTICE '  All application table rows deleted.';
  RAISE NOTICE '  Default settings row re-seeded.';
  RAISE NOTICE '  NEXT: Delete storage files via Dashboard > Storage > asat-uploads > Empty Bucket';
  RAISE NOTICE '  NEXT: Delete auth users via Dashboard > Authentication > Users > Delete All';
  RAISE NOTICE '  OR run: node backend/sql/flush_storage.js';
END $$;
