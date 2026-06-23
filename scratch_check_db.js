import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Error: missing env variables');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  const { data: categories, error: catErr } = await supabaseAdmin
    .from('categories')
    .select('*');
  console.log('--- CATEGORIES ---');
  console.log(categories);

  const { data: products, error: prodErr } = await supabaseAdmin
    .from('products')
    .select('*')
    .limit(5);
  console.log('--- PRODUCTS (sample) ---');
  console.log(products);

  const { data: catalogue, error: catItemErr } = await supabaseAdmin
    .from('catalogue')
    .select('*')
    .limit(5);
  console.log('--- CATALOGUE (sample) ---');
  console.log(catalogue);

  const { data: designs, error: desErr } = await supabaseAdmin
    .from('designs')
    .select('*, products:base_product_id(*), catalogue:catalogue_item_id(*)')
    .limit(5);
  console.log('--- DESIGNS (sample) ---');
  console.log(JSON.stringify(designs, null, 2));
}

main().catch(console.error);
