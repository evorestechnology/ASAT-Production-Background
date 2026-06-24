import { supabaseAdmin } from './src/supabaseAdmin.js';

async function testFilter() {
  const { data, error } = await supabaseAdmin
    .from('designs')
    .select('id, title, base_product_id, products(available)')
    .in('status', ['approved', 'active'])
    .not('products.available', 'eq', false);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Returned rows:', data.length);
    console.log(data);
  }
}

testFilter();
