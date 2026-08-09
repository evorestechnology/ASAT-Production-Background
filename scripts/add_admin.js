import { supabaseAdmin } from '../src/supabaseAdmin.js';
import readline from 'readline';

/**
 * Helper to prompt in terminal if args not provided
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans.trim());
    })
  );
}

async function addAdmin() {
  console.log('👑 ========================================');
  console.log('👑        ASAT CREATE ADMIN SCRIPT        ');
  console.log('👑 ========================================\n');

  // Parse command line arguments: node scripts/add_admin.js <email> <password> <fullName>
  const args = process.argv.slice(2);
  let email = args[0];
  let password = args[1];
  let fullName = args[2];

  if (!email) {
    email = await askQuestion('Enter Admin Email [default: admin@asat.com]: ');
    if (!email) email = 'admin@asat.com';
  }

  if (!password) {
    password = await askQuestion('Enter Admin Password [default: Admin@123456]: ');
    if (!password) password = 'Admin@123456';
  }

  if (!fullName) {
    fullName = await askQuestion('Enter Admin Full Name [default: Master Admin]: ');
    if (!fullName) fullName = 'Master Admin';
  }

  email = email.trim().toLowerCase();

  console.log(`\n⏳ Setting up admin account for: ${email}...`);

  try {
    // 1. Check if user already exists in auth.users
    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (!listError && listData?.users) {
      const existingUser = listData.users.find((u) => u.email?.toLowerCase() === email);
      if (existingUser) {
        console.log(`ℹ️  Found existing auth user (${existingUser.id}). Deleting and recreating...`);
        await supabaseAdmin.auth.admin.deleteUser(existingUser.id);
        // Also remove from admins table if left behind
        await supabaseAdmin.from('admins').delete().eq('email', email);
      }
    }

    // 2. Create Auth User
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: 'admin',
      },
    });

    if (authError) {
      throw new Error(`Auth user creation failed: ${authError.message}`);
    }

    const uid = authData.user.id;
    console.log(`✅ Auth user created (UID: ${uid})`);

    // 3. Upsert into public.admins table
    const { error: dbError } = await supabaseAdmin.from('admins').upsert({
      id: uid,
      email,
      full_name: fullName,
      created_at: new Date().toISOString(),
    });

    if (dbError) {
      console.error('❌ DB Error inserting into public.admins:', dbError.message);
      console.log('🔄 Rolling back auth user...');
      await supabaseAdmin.auth.admin.deleteUser(uid);
      throw dbError;
    }

    console.log('\n🎉 ========================================');
    console.log('🎉      ADMIN CREATED SUCCESSFULLY!       ');
    console.log('🎉 ========================================');
    console.log(`📧 Email:     ${email}`);
    console.log(`🔑 Password:  ${password}`);
    console.log(`👤 Name:      ${fullName}`);
    console.log(`🔗 Login URL: /master/login`);
    console.log('==========================================\n');
  } catch (err) {
    console.error('\n❌ Failed to create admin:', err.message);
    process.exit(1);
  }
}

addAdmin();
