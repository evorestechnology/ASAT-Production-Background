import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read .env manually
let env = {};
try {
  const envContent = readFileSync(path.join(__dirname, '../.env'), 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length > 0) env[key.trim()] = val.join('=').trim();
  });
} catch (e) {
  console.warn('⚠️ Warning: Could not read .env file.');
}

const supabaseUrl = env.VITE_SUPABASE_URL || 'https://dwlvqfneekhtrgrfrjpc.supabase.co';
const serviceRoleKey = process.argv[2] || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('❌ Error: VITE_SUPABASE_URL is missing.');
  process.exit(1);
}

if (!serviceRoleKey) {
  console.error('❌ Error: Supabase Service Role Key is missing.');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function createMaster() {
  const email = 'master@asat.com';
  const password = 'MasterPassword123'; // Default temporary password
  const fullName = 'master';

  console.log(`🚀 Creating Master Admin account for: ${email}...`);

  // First, let's clean up any existing user with this email to avoid conflict
  console.log('🔄 Cleaning up existing master@asat.com records from auth/admins...');
  try {
    const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = listData?.users?.find(u => u.email === email);
    if (existingUser) {
      console.log(`Deleting existing auth user: ${existingUser.id}`);
      await supabaseAdmin.auth.admin.deleteUser(existingUser.id);
    }
  } catch (err) {
    console.log('No user clean up needed or listUsers failed: ', err.message);
  }

  // 1. Create auth user in Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (authError) {
    console.error('❌ Error creating auth user:', authError.message);
    process.exit(1);
  }

  const uid = authData.user.id;
  console.log(`✅ Auth user created successfully! UID: ${uid}`);

  // 2. Insert into public.admins table
  const { error: dbError } = await supabaseAdmin.from('admins').insert({
    id: uid,
    email: email,
    full_name: fullName
  });

  if (dbError) {
    console.error('❌ Error inserting into public.admins table:', dbError.message);
    console.log('🔄 Rolling back auth user...');
    await supabaseAdmin.auth.admin.deleteUser(uid);
    process.exit(1);
  }

  console.log(`\n🎉 MASTER ADMIN CREATED SUCCESSFULLY!`);
  console.log(`-------------------------------------------`);
  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log(`-------------------------------------------`);
  console.log(`You can now sign in at /master/login`);
}

createMaster().catch(console.error);
