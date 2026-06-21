import { supabaseAdmin } from './src/supabaseAdmin.js';

async function test() {
  // Query category table details or structure
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('Error fetching categories:', error);
  } else {
    console.log('Categories columns present:', data && data.length > 0 ? Object.keys(data[0]) : 'No rows returned to extract keys');
  }
}

test();
