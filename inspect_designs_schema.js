import { supabaseAdmin } from './src/supabaseAdmin.js';

async function test() {
  // Fetch columns info or a single row to inspect structure
  const { data, error } = await supabaseAdmin
    .from('designs')
    .select('*')
    .limit(1);
  
  if (error) {
    console.error('Error fetching designs:', error);
  } else {
    console.log('Columns in designs table:', data.length > 0 ? Object.keys(data[0]) : 'No data, checking table definition...');
    if (data.length > 0) {
      console.log('Sample row:', JSON.stringify(data[0], null, 2));
    }
  }
}

test();
