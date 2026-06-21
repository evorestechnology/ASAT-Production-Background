import { supabaseAdmin } from './src/supabaseAdmin.js';
import crypto from 'crypto';

const uuid = () => crypto.randomUUID();

async function run() {
  const prod = { id: uuid(), title: 'Test Prod', category: 't-shirts', cost: 100, mfg_id: uuid() };
  
  const statusesToTest = ['pending', 'pending_approval', 'approved', 'rejected', 'hidden', 'restricted'];
  for (const status of statusesToTest) {
    const design = { 
      id: uuid(), 
      title: 'Test Design', 
      price: 100,
      catalogue_item_id: prod.id, 
      designer_id: uuid(),
      status: status
    };
    
    // Just try inserting, ignoring foreign keys because we can't test constraints without them
    // Wait, foreign keys check runs FIRST, before check constraints? Actually CHECK runs first usually, but let's test it.
    
    const { error } = await supabaseAdmin.from('designs').insert(design);
    console.log(`Status '${status}':`, error?.code === '23514' ? 'CHECK FAILED' : error?.message || 'SUCCESS');
  }
}

run();
