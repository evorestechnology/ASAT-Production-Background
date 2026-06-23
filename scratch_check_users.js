import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: missing env variables');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('*');
  
  if (error) {
    console.error(error);
  } else {
    console.log('--- USERS ---');
    console.log(users);
  }
}

main().catch(console.error);
