-- ═══════════════════════════════════════════════════════════════════
--  ASAT SELECTIVE FLUSH SCRIPT (PRESERVING MASTER/ADMIN ACCOUNTS)
--
--  Wipes:
--    * All regular user, designer, manufacturer, and order details
--    * All products, designs, print styles, and ticket messages
--    * All non-admin Supabase Auth users (login credentials)
--
--  Preserves:
--    * All Master/Admin accounts in public.admins
--    * All Admin login credentials in auth.users
--    * Core platform settings (earnings, currencies)
--
--  Run in: Supabase Dashboard > SQL Editor > New Query
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE 'ASAT SELECTIVE FLUSH: Deleting all user and file details except Admins...';
END $$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 1: Check that at least one admin exists (Safety Guard)
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  admin_count INT;
BEGIN
  SELECT COUNT(*) INTO admin_count FROM public.admins;
  IF admin_count = 0 THEN
    RAISE EXCEPTION 'Safety check failed: No admins found in public.admins. Aborting to avoid lockout!';
  ELSE
    RAISE NOTICE 'Found % admin(s) in public.admins. Preserving them.', admin_count;
  END IF;
END $$;


-- ════════════════════════════════════════════════════════════════════
--  STEP 2: Disable FK triggers for fast, safe cascade deletion
-- ════════════════════════════════════════════════════════════════════
SET session_replication_role = 'replica';


-- ════════════════════════════════════════════════════════════════════
--  STEP 3: Delete data from user-dependent application tables
-- ════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
  tables_to_flush TEXT[] := ARRAY[
    'ticket_messages',
    'tickets',
    'withdrawals',
    'orders',
    'designs',
    'print_styles',
    'products',
    'user_addresses',
    'admin_invites',
    'otps',
    'manufacturers',
    'designers',
    'users'
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_flush LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = t
    ) THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
      RAISE NOTICE 'Truncated table: %', t;
    ELSE
      RAISE NOTICE 'Skipped (does not exist): %', t;
    END IF;
  END LOOP;
END $$;

-- Truncate non-admin wallets while preserving admin wallets
DELETE FROM public.wallets 
WHERE id NOT IN (SELECT id FROM public.admins);


-- ════════════════════════════════════════════════════════════════════
--  STEP 4: Re-enable FK triggers
-- ════════════════════════════════════════════════════════════════════
SET session_replication_role = 'origin';


-- ════════════════════════════════════════════════════════════════════
--  STEP 5: Delete all non-admin Supabase Auth users
-- ════════════════════════════════════════════════════════════════════
DELETE FROM auth.users
WHERE id NOT IN (SELECT id FROM public.admins);


-- ════════════════════════════════════════════════════════════════════
--  STEP 6: Re-seed / ensure platform settings exist
-- ════════════════════════════════════════════════════════════════════
INSERT INTO public.settings (key, value)
VALUES ('earnings', '{"designer": 30, "mfg": 40, "platform": 30}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();


-- ════════════════════════════════════════════════════════════════════
--  DONE
-- ════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'ASAT Selective Flush complete.';
  RAISE NOTICE '  - All user and file records deleted.';
  RAISE NOTICE '  - Non-admin auth accounts deleted.';
  RAISE NOTICE '  - All Admin accounts safely intact.';
  RAISE NOTICE '  - To delete files in storage, run "npm run flush-except-admin" in backend or empty asat-uploads bucket via Dashboard.';
END $$;
