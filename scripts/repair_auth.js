import { supabaseAdmin } from '../src/supabaseAdmin.js';

async function repairAndCreateAdmin() {
  const email = 'admin@asat.com';
  const password = 'Admin@123456';
  const fullName = 'Master Admin';

  console.log('🔍 Checking Supabase Auth service & user list...');

  try {
    const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      console.error('❌ Failed to list users:', listError);
    } else {
      console.log(`Found ${listData.users.length} user(s) in auth.users:`);
      for (const u of listData.users) {
        console.log(` - ID: ${u.id}, Email: ${u.email}`);
        if (u.email?.toLowerCase() === email.toLowerCase()) {
          console.log(`   🗑️ Deleting broken/existing user: ${u.id}...`);
          const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
          if (delErr) console.error('   ❌ Delete error:', delErr.message);
          else console.log('   ✅ Deleted user from Auth.');
        }
      }
    }

    // Clean up public.admins
    await supabaseAdmin.from('admins').delete().eq('email', email);

    console.log(`\n✨ Creating fresh admin user "${email}" via Supabase Admin API...`);
    const { data: authUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role: 'admin'
      }
    });

    if (createError) {
      console.error('❌ Failed to create admin user:', createError);
      return;
    }

    console.log(`✅ Auth user created successfully! UID: ${authUser.user.id}`);

    // Insert into public.admins table
    const { error: dbError } = await supabaseAdmin.from('admins').upsert({
      id: authUser.user.id,
      email: email,
      full_name: fullName,
      created_at: new Date().toISOString()
    });

    if (dbError) {
      console.error('❌ Failed to insert into public.admins:', dbError);
      return;
    }

    console.log('✅ Admin record inserted into public.admins table.');

    // Test sign in directly via GoTrue to verify password grant
    console.log('\n🧪 Testing signInWithPassword directly...');
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (signInError) {
      console.error('❌ signInWithPassword test failed:', signInError);
    } else {
      console.log('🎉 SUCCESS! Password authentication works without 500 error.');
      console.log(`   Access Token generated for user: ${signInData.user.email}`);
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

repairAndCreateAdmin();
