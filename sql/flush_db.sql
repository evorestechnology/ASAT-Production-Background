-- ═══════════════════════════════════════════════════════════════════
--  ASAT DATABASE FLUSH SCRIPT
--  Wipes ALL data from every table while preserving schema, indexes,
--  RLS policies, and storage bucket configuration.
--
--  ⚠️  WARNING: THIS IS IRREVERSIBLE. ALL DATA WILL BE PERMANENTLY LOST.
--  Run in: Supabase Dashboard → SQL Editor → New Query
--
--  Order matters: child tables first, then parents (respects FK constraints)
-- ═══════════════════════════════════════════════════════════════════

-- ─── Safety confirmation ─────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '⚠️  ASAT DATABASE FLUSH SCRIPT';
  RAISE NOTICE '    This script will DELETE ALL ROWS from every application table.';
  RAISE NOTICE '    Schema, indexes, RLS policies, and storage config are preserved.';
  RAISE NOTICE '    Auth users in auth.users are NOT deleted by this script.';
  RAISE NOTICE '    Proceeding in 3... 2... 1...';
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
--  STEP 5: (Optional) Flush Supabase Storage objects for asat-uploads
--  Uncomment the block below if you also want to wipe uploaded files.
--  Note: This only removes the metadata rows. To delete actual files,
--  use Supabase Dashboard → Storage → asat-uploads → Empty bucket.
-- ════════════════════════════════════════════════════════════════════

-- DELETE FROM storage.objects WHERE bucket_id = 'asat-uploads';


-- ════════════════════════════════════════════════════════════════════
--  STEP 6: (Optional) Delete Supabase Auth users
--  Uncomment ONLY if you want to wipe all auth.users too.
--  ⚠️  This will prevent any existing user from logging in.
-- ════════════════════════════════════════════════════════════════════

-- DELETE FROM auth.users;


-- ════════════════════════════════════════════════════════════════════
--  DONE
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE '✅ ASAT database flushed successfully.';
  RAISE NOTICE '   All application data deleted. Schema preserved.';
  RAISE NOTICE '   Default settings row re-inserted.';
  RAISE NOTICE '   Auth users in auth.users were NOT deleted.';
  RAISE NOTICE '   Storage files were NOT deleted (uncomment Step 5 to do so).';
END $$;
