import { supabaseAdmin } from './src/supabaseAdmin.js';

async function test() {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, title, category, printing_styles');
  
  if (error) {
    console.error('Error fetching products:', error);
  } else {
    console.log('Products in DB:', JSON.stringify(data, null, 2));
  }
}

test();
