import { supabaseAdmin } from '../src/supabaseAdmin.js';

async function migrate() {
  console.log('Starting data migration for print styles category...');
  
  // 1. Fetch all print styles
  const { data: styles, error: fetchErr } = await supabaseAdmin
    .from('print_styles')
    .select('*');
    
  if (fetchErr) {
    console.error('Error fetching print styles:', fetchErr);
    process.exit(1);
  }
  
  console.log(`Found ${styles.length} print styles in database.`);
  
  // 2. Update each to have 'category' set to 'DTF' if not set
  let updatedCount = 0;
  for (const style of styles) {
    if (!style.category) {
      const { error: updateErr } = await supabaseAdmin
        .from('print_styles')
        .update({ category: 'DTF' })
        .eq('id', style.id);
        
      if (updateErr) {
        console.error(`Failed to update style ID ${style.id}:`, updateErr.message);
      } else {
        updatedCount++;
      }
    }
  }
  
  console.log(`Successfully migrated ${updatedCount} print styles to category 'DTF'.`);
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration crashed:', err);
  process.exit(1);
});
