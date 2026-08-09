import { supabaseAdmin } from '../src/supabaseAdmin.js';

/**
 * Complete Flush Script for ASAT:
 * 1. Deletes all files in Supabase Storage (`asat-uploads` bucket)
 * 2. Deletes all Supabase Auth Users
 * 3. Deletes/Truncates all rows in all database tables
 * 4. Re-seeds required default settings
 */
async function flushAll() {
  console.log('🔴 ====================================================');
  console.log('🔴 STARTING COMPLETE ASAT FLUSH (DB + AUTH + STORAGE)');
  console.log('🔴 ====================================================\n');

  // ─────────────────────────────────────────────────────────────
  // 1. DELETE ALL FILES IN STORAGE BUCKET (asat-uploads)
  // ─────────────────────────────────────────────────────────────
  console.log('📦 [1/3] Deleting all files from Supabase Storage (asat-uploads)...');
  try {
    const bucket = 'asat-uploads';
    
    // Recursive file finder in bucket
    async function listAllFiles(folder = '') {
      const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder, {
        limit: 1000,
        offset: 0,
      });

      if (error) {
        console.warn(`Could not list files in folder "${folder}":`, error.message);
        return [];
      }

      let files = [];
      for (const item of data || []) {
        const fullPath = folder ? `${folder}/${item.name}` : item.name;
        if (item.id === null) {
          // Folder
          const nested = await listAllFiles(fullPath);
          files = files.concat(nested);
        } else {
          // File
          files.push(fullPath);
        }
      }
      return files;
    }

    const allFiles = await listAllFiles('');
    console.log(`Found ${allFiles.length} file(s) in "${bucket}".`);

    if (allFiles.length > 0) {
      // Supabase remove takes an array of paths
      const batchSize = 100;
      for (let i = 0; i < allFiles.length; i += batchSize) {
        const batch = allFiles.slice(i, i + batchSize);
        const { error: deleteErr } = await supabaseAdmin.storage.from(bucket).remove(batch);
        if (deleteErr) {
          console.error(`Failed to delete batch:`, deleteErr.message);
        } else {
          console.log(`Deleted ${batch.length} files...`);
        }
      }
      console.log('✅ Storage files successfully cleared.');
    } else {
      console.log('✅ No storage files to delete.');
    }
  } catch (err) {
    console.error('⚠️  Error flushing storage:', err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. DELETE ALL SUPABASE AUTH USERS
  // ─────────────────────────────────────────────────────────────
  console.log('\n👥 [2/3] Deleting all Supabase Auth Users...');
  try {
    let hasMore = true;
    let totalDeleted = 0;

    while (hasMore) {
      const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });

      if (error) {
        throw error;
      }

      if (!users || users.length === 0) {
        hasMore = false;
        break;
      }

      for (const user of users) {
        const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
        if (delErr) {
          console.error(`Failed to delete user ${user.id} (${user.email}):`, delErr.message);
        } else {
          totalDeleted++;
        }
      }

      if (users.length < 1000) {
        hasMore = false;
      }
    }
    console.log(`✅ Deleted ${totalDeleted} auth user(s).`);
  } catch (err) {
    console.error('⚠️  Error deleting auth users:', err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // 3. DELETE ALL TABLE ROWS & RE-SEED
  // ─────────────────────────────────────────────────────────────
  console.log('\n🗄️  [3/3] Truncating all database tables...');
  
  const tables = [
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

  for (const table of tables) {
    try {
      const { error } = await supabaseAdmin
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all matching rows
      
      if (error) {
        // Fallback for tables without UUID id like otps, settings
        if (table === 'otps') {
          await supabaseAdmin.from('otps').delete().neq('email', '');
        } else if (table === 'settings') {
          await supabaseAdmin.from('settings').delete().neq('key', '');
        } else {
          console.warn(`Table "${table}" deletion notice:`, error.message);
        }
      }
      console.log(`Cleared table: ${table}`);
    } catch (e) {
      console.warn(`Skipped table ${table}:`, e.message);
    }
  }

  // Re-seed default settings
  console.log('\n🌱 Re-seeding default settings...');
  try {
    await supabaseAdmin.from('settings').upsert({
      key: 'earnings',
      value: { designer: 30, mfg: 40, platform: 30 },
      updated_at: new Date().toISOString()
    });
    console.log('✅ Re-seeded settings (earnings split config).');
  } catch (seedErr) {
    console.error('⚠️ Failed to re-seed settings:', seedErr.message);
  }

  console.log('\n🎉 ====================================================');
  console.log('🎉 ALL DATABASE DATA, AUTH USERS & FILES FLUSHED!');
  console.log('🎉 You can now start with a clean slate.');
  console.log('🎉 ====================================================\n');
}

flushAll().catch(err => {
  console.error('Fatal error during flush:', err);
  process.exit(1);
});
