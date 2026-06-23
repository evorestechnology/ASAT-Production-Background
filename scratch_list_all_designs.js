import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data, error } = await supabaseAdmin
    .from('designs')
    .select('id, title, status, base_product_id, products:base_product_id(category), catalogue:catalogue_item_id(category)');

  console.log('--- ALL DESIGNS IN DB ---');
  console.log(data);
}

main().catch(console.error);
