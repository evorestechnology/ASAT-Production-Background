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
--  STEP 2: Truncate every application table (cascades handled by FK bypass)
-- ════════════════════════════════════════════════════════════════════

TRUNCATE TABLE
  ticket_messages
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  tickets
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  withdrawals
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  wallets
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  orders
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  designs
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  print_styles
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  products
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  user_addresses
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  admin_invites
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  otps
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  catalogue
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  categories
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  manufacturers
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  designers
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  admins
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  users
  RESTART IDENTITY CASCADE;

TRUNCATE TABLE
  settings
  RESTART IDENTITY CASCADE;


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
--  STEP 5: Delete all uploaded storage files (asat-uploads bucket)
--
--  Removes metadata rows + triggers blob deletion in Supabase storage.
--  If blobs remain: Dashboard > Storage > asat-uploads > Select All > Delete
-- ════════════════════════════════════════════════════════════════════
DELETE FROM storage.objects WHERE bucket_id = 'asat-uploads';


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
  RAISE NOTICE 'ASAT full flush complete.';
  RAISE NOTICE '  All application table rows deleted.';
  RAISE NOTICE '  All storage files deleted (asat-uploads).';
  RAISE NOTICE '  All auth.users deleted.';
  RAISE NOTICE '  Default settings row re-seeded.';
  RAISE NOTICE '  Database is empty and ready for fresh use.';
END $$;
