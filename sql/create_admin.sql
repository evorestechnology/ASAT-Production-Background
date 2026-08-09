-- ══════════════════════════════════════════════════════════════
-- CREATE MASTER ADMIN USER
-- Run these queries in your Supabase Dashboard -> SQL Editor
-- ══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- METHOD 1: Elevate an Existing User Account (Recommended & Safest)
-- ─────────────────────────────────────────────────────────────
-- Step 1: Register a new account via the frontend registration page (e.g. at /register).
-- Step 2: Run the following SQL queries to move them to the admins table.

-- Replace 'your_admin_email@example.com' with the email you registered:
INSERT INTO public.admins (id, email, full_name)
SELECT id, email, full_name 
FROM public.users 
WHERE email = 'your_admin_email@example.com'
ON CONFLICT (id) DO NOTHING;

-- (Optional) Remove them from the customers table so they don't show up as a customer:
DELETE FROM public.users 
WHERE email = 'your_admin_email@example.com';


-- ─────────────────────────────────────────────────────────────
-- METHOD 2: Direct SQL Insert (Create New Admin from Scratch)
-- ─────────────────────────────────────────────────────────────
-- This script creates a new user inside auth.users (hashing the password with bcrypt)
-- and inserts them directly into the public.admins table.

-- Ensure pgcrypto extension is active (for hashing passwords):
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  new_uid UUID := gen_random_uuid();
  admin_email TEXT := 'master@asat.com';       -- <--- Change to desired admin email
  admin_password TEXT := 'MasterPassword123'; -- <--- Change to desired admin password
  admin_name TEXT := 'Master Admin';          -- <--- Change to admin name
BEGIN
  -- 1. Insert into auth.users
  INSERT INTO auth.users (
    id,
    instance_id,
    role,
    aud,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  VALUES (
    new_uid,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    admin_email,
    crypt(admin_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', admin_name),
    now(),
    now()
  );

  -- 2. Insert into public.admins
  INSERT INTO public.admins (id, email, full_name)
  VALUES (new_uid, admin_email, admin_name);

  RAISE NOTICE 'Admin user created successfully with UID %', new_uid;
END $$; 
