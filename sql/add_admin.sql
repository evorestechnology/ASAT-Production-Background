-- ═══════════════════════════════════════════════════════════════════
--  ASAT ADD ADMIN SCRIPT (SQL Editor)
--
--  Use this to add or link an admin if you created an account in
--  Supabase Auth (Dashboard > Authentication > Users > Add User).
-- ═══════════════════════════════════════════════════════════════════

-- Replace with the user's email and desired full name:
DO $$
DECLARE
  target_email TEXT := 'admin@asat.com';
  target_name  TEXT := 'Master Admin';
  user_uid     UUID;
BEGIN
  -- 1. Find user UID from auth.users
  SELECT id INTO user_uid
  FROM auth.users
  WHERE email = target_email;

  IF user_uid IS NULL THEN
    RAISE EXCEPTION 'User with email "%" not found in auth.users. Please create the user in Supabase Auth first or run "npm run add-admin" via Node.', target_email;
  END IF;

  -- 2. Insert or update in admins table
  INSERT INTO public.admins (id, email, full_name, created_at)
  VALUES (user_uid, target_email, target_name, now())
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  RAISE NOTICE '✅ Admin "%" (%) successfully created/updated in public.admins table!', target_name, target_email;
END $$;
