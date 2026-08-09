import { supabaseAdmin } from '../src/supabaseAdmin.js';

async function checkAuthDb() {
  console.log('Testing general table query to verify Postgres connection...');
  const { data, error } = await supabaseAdmin.from('settings').select('*');
  if (error) {
    console.error('Database connection error:', error);
  } else {
    console.log('✅ Database connection is working! Settings:', data);
  }
}

checkAuthDb();
