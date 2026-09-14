import { supabaseAdmin } from '../src/supabaseAdmin.js';

/**
 * ═════════════════════════════════════════════════════════════════════════
 *  ASAT DATABASE, STORAGE & AUTH FLUSH (PRESERVING MASTER/ADMIN ACCOUNTS)
 * ═════════════════════════════════════════════════════════════════════════
 *
 * This script deletes:
 *  1. All storage files (in asat-uploads and any custom buckets)
 *  2. All user-related records (designs, products, print styles, orders,
 *     tickets, addresses, wallets, designers, manufacturers, users)
 *  3. All Supabase Auth users EXCEPT master/admin users
 *
 * Preserves:
 *  - Master/Admin accounts in public.admins
 *  - Master/Admin credentials in auth.users
 *  - Core platform configurations (settings, categories, catalogue)
 */

async function flushExceptAdmin() {
  console.log('🛡️  ================================================================');
  console.log('🛡️   STARTING SELECTIVE FLUSH (PRESERVING ALL ADMIN ACCOUNTS)');
  console.log('🛡️  ================================================================\n');

  // ─────────────────────────────────────────────────────────────
  // STEP 1: IDENTIFY & PROTECT ADMIN ACCOUNTS
  // ─────────────────────────────────────────────────────────────
  console.log('🔍 [Step 1/4] Detecting Admin Accounts...');
  const { data: admins, error: adminErr } = await supabaseAdmin.from('admins').select('*');

  if (adminErr) {
    console.error('❌ Failed to query "admins" table:', adminErr.message);
    console.error('Aborting to prevent accidental data loss.');
    process.exit(1);
  }

  if (!admins || admins.length === 0) {
    console.error('❌ No admin accounts found in the "admins" table!');
    console.error('To prevent total lockout, create an admin first (npm run add-admin) before running this script.');
    process.exit(1);
  }

  const adminIds = new Set(admins.map(a => a.id));
  const adminEmails = new Set(admins.map(a => (a.email || '').trim().toLowerCase()).filter(Boolean));

  console.log(`✅ Found ${admins.length} Admin account(s) to PRESERVE:`);
  admins.forEach(a => {
    console.log(`   👑 ${a.full_name || 'Admin'} | ${a.email} | ID: ${a.id}`);
  });

  // ─────────────────────────────────────────────────────────────
  // STEP 2: DELETE ALL STORAGE FILES (MOCKUPS, DESIGNS, UPLOADS)
  // ─────────────────────────────────────────────────────────────
  console.log('\n📦 [Step 2/4] Deleting all uploaded files in Supabase Storage...');
  try {
    let bucketNames = ['asat-uploads'];
    const { data: buckets, error: bucketErr } = await supabaseAdmin.storage.listBuckets();
    if (!bucketErr && buckets && buckets.length > 0) {
      bucketNames = Array.from(new Set([...bucketNames, ...buckets.map(b => b.name || b.id)]));
    }

    for (const bucket of bucketNames) {
      console.log(`   📂 Scanning bucket: "${bucket}"...`);

      // Recursive file finder helper
      async function listBucketFiles(folder = '') {
        const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder, {
          limit: 1000,
          offset: 0,
        });

        if (error) {
          return [];
        }

        let files = [];
        for (const item of data || []) {
          const itemPath = folder ? `${folder}/${item.name}` : item.name;
          if (!item.id && (item.metadata === null || !item.metadata)) {
            // Folder -> recurse
            const nested = await listBucketFiles(itemPath);
            files = files.concat(nested);
          } else {
            // File
            files.push(itemPath);
          }
        }
        return files;
      }

      const filesToDelete = await listBucketFiles('');
      console.log(`   Found ${filesToDelete.length} file(s) in "${bucket}".`);

      if (filesToDelete.length > 0) {
        const batchSize = 100;
        let deletedCount = 0;
        for (let i = 0; i < filesToDelete.length; i += batchSize) {
          const batch = filesToDelete.slice(i, i + batchSize);
          const { error: delErr } = await supabaseAdmin.storage.from(bucket).remove(batch);
          if (delErr) {
            console.warn(`   ⚠️ Warning deleting batch in "${bucket}":`, delErr.message);
          } else {
            deletedCount += batch.length;
          }
        }
        console.log(`   🗑️  Deleted ${deletedCount} file(s) from "${bucket}".`);
      }
    }
    console.log('✅ Storage files cleared successfully.');
  } catch (err) {
    console.warn('⚠️  Storage file deletion encountered an issue:', err.message);
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 3: DELETE APPLICATION DATA (EXCEPT ADMINS & SETTINGS)
  // ─────────────────────────────────────────────────────────────
  console.log('\n🗄️  [Step 3/4] Clearing user, design, product, and transaction tables...');

  // Dependency order: child tables first to avoid FK constraint violations
  const tablesToClear = [
    'ticket_messages',
    'support_tickets',
    'tickets',
    'withdrawals',
    'orders',
    'designs',
    'products',
    'print_styles',
    'user_addresses',
    'cart_items',
    'cart',
    'wishlist',
    'activity_logs',
    'otps',
    'designers',
    'manufacturers',
    'users'
  ];

  for (const table of tablesToClear) {
    try {
      const { error } = await supabaseAdmin
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (error) {
        if (table === 'otps') {
          await supabaseAdmin.from('otps').delete().neq('email', '');
        } else {
          console.warn(`   ⚠️ Table "${table}" note: ${error.message}`);
        }
      } else {
        console.log(`   🗑️  Cleared table: ${table}`);
      }
    } catch (e) {
      console.warn(`   ⚠️ Skipped table "${table}": ${e.message}`);
    }
  }

  // Wallets: Delete wallets that do not belong to an Admin
  try {
    const { data: allWallets } = await supabaseAdmin.from('wallets').select('id');
    if (allWallets && allWallets.length > 0) {
      const nonAdminWalletIds = allWallets
        .map(w => w.id)
        .filter(id => !adminIds.has(id));

      if (nonAdminWalletIds.length > 0) {
        await supabaseAdmin.from('wallets').delete().in('id', nonAdminWalletIds);
        console.log(`   🗑️  Cleared ${nonAdminWalletIds.length} non-admin wallet(s).`);
      }
    }
  } catch (wErr) {
    console.warn('   ⚠️ Wallets cleanup note:', wErr.message);
  }

  // Ensure default earnings settings are intact
  try {
    await supabaseAdmin.from('settings').upsert({
      key: 'earnings',
      value: { designer: 30, mfg: 40, platform: 30 },
      updated_at: new Date().toISOString()
    });
    console.log('   ✅ Preserved platform settings (earnings split).');
  } catch (sErr) {
    console.warn('   ⚠️ Settings note:', sErr.message);
  }

  // ─────────────────────────────────────────────────────────────
  // STEP 4: DELETE SUPABASE AUTH USERS (EXCEPT ADMINS)
  // ─────────────────────────────────────────────────────────────
  console.log('\n👥 [Step 4/4] Deleting non-admin Supabase Auth Users...');
  let totalAuthDeleted = 0;
  let totalAuthPreserved = 0;

  try {
    let page = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage
      });

      if (error) {
        console.error('❌ Error listing auth users:', error.message);
        break;
      }

      const users = data?.users || [];
      if (users.length === 0) {
        hasMore = false;
        break;
      }

      for (const u of users) {
        const uEmail = (u.email || '').trim().toLowerCase();
        const isAdmin = adminIds.has(u.id) || adminEmails.has(uEmail);

        if (isAdmin) {
          totalAuthPreserved++;
          console.log(`   🛡️  Preserving Admin Auth User: ${u.email} (${u.id})`);
        } else {
          const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(u.id);
          if (delErr) {
            console.warn(`   ⚠️ Could not delete auth user ${u.email || u.id}:`, delErr.message);
          } else {
            totalAuthDeleted++;
            console.log(`   👤 Deleted non-admin auth user: ${u.email || u.id}`);
          }
        }
      }

      if (users.length < perPage) {
        hasMore = false;
      } else {
        page++;
      }
    }

    console.log(`\n✅ Auth Cleanup Finished: ${totalAuthDeleted} deleted, ${totalAuthPreserved} admin(s) preserved.`);
  } catch (authErr) {
    console.error('⚠️  Auth user cleanup error:', authErr.message);
  }

  console.log('\n🎉 ================================================================');
  console.log('🎉  SELECTIVE FLUSH COMPLETE!');
  console.log(`🎉  - All storage files deleted.`);
  console.log(`🎉  - All user, designer, manufacturer, and order details cleared.`);
  console.log(`🎉  - ${totalAuthDeleted} non-admin auth user(s) removed.`);
  console.log(`🎉  - ${admins.length} Admin account(s) safely preserved.`);
  console.log('🎉 ================================================================\n');
  process.exit(0);
}

flushExceptAdmin().catch(err => {
  console.error('Fatal error during selective flush:', err);
  process.exit(1);
});
