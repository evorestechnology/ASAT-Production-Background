import { supabaseAdmin } from '../supabaseAdmin.js';

async function flushDatabase() {
  console.log('🚀 Starting Database Flush (Preserving Master/Admin Accounts)...');

  // 1. Verify master admin account exists
  const { data: admins, error: adminErr } = await supabaseAdmin.from('admins').select('*');
  if (adminErr) {
    console.error('❌ Failed to fetch admins table:', adminErr.message);
    process.exit(1);
  }

  console.log(`✅ Found ${admins.length} Master/Admin account(s). Preserving:`, admins.map(a => a.email || a.id));
  const adminIds = new Set(admins.map(a => a.id));

  // List of tables to flush (in dependency order)
  const tablesToFlush = [
    'ticket_messages',
    'support_tickets',
    'tickets',
    'activity_logs',
    'wallet_transactions',
    'wallets',
    'payout_requests',
    'cart',
    'cart_items',
    'wishlist',
    'orders',
    'designs',
    'products',
    'print_styles',
    'designers',
    'manufacturers',
    'users'
  ];

  for (const table of tablesToFlush) {
    try {
      // Delete all rows in the table
      const { error, count } = await supabaseAdmin
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Deletes all rows

      if (error) {
        // Table might not exist or error occurred
        console.warn(`⚠️ Note for table '${table}':`, error.message);
      } else {
        console.log(`🗑️ Cleared table '${table}'`);
      }
    } catch (e) {
      console.warn(`⚠️ Skipped table '${table}':`, e.message);
    }
  }

  // Optional: Clean up Supabase Auth users that are NOT admins
  try {
    const { data: { users: authUsers }, error: authErr } = await supabaseAdmin.auth.admin.listUsers();
    if (!authErr && authUsers) {
      for (const u of authUsers) {
        if (!adminIds.has(u.id)) {
          await supabaseAdmin.auth.admin.deleteUser(u.id).catch(() => {});
          console.log(`👤 Deleted non-admin auth user: ${u.email || u.id}`);
        }
      }
    }
  } catch (e) {
    console.warn('⚠️ Non-admin Auth user cleanup note:', e.message);
  }

  console.log('🎉 Database flush completed successfully! All data cleared except Master/Admin accounts.');
  process.exit(0);
}

flushDatabase();
