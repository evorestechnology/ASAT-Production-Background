import { supabaseAdmin } from './src/supabaseAdmin.js';
import crypto from 'crypto';

const uuid = () => crypto.randomUUID();

async function run() {
  const mfg = { id: uuid(), business_name: 'Test Mfg' };
  const cat = { id: uuid(), slug: 'test-cat', name: 'Test Cat' };
  const prod = { id: uuid(), title: 'Test Prod', category: cat.slug, cost: 100, mfg_id: mfg.id };
  const desId = uuid();
  const user = { id: desId, email: 'test@test.com', full_name: 'Test' };
  const designer = { id: desId, username: 'test_d' };
  const design = { id: uuid(), title: 'Test Design', catalogue_item_id: prod.id, designer_id: desId };

  let errs = [];
  errs.push((await supabaseAdmin.from('manufacturers').insert(mfg)).error);
  errs.push((await supabaseAdmin.from('categories').insert(cat)).error);
  errs.push((await supabaseAdmin.from('products').insert(prod)).error);
  errs.push((await supabaseAdmin.from('users').insert(user)).error);
  errs.push((await supabaseAdmin.from('designers').insert(designer)).error);
  errs.push((await supabaseAdmin.from('designs').insert(design)).error);

  console.log('Errors:', JSON.stringify(errs.filter(Boolean), null, 2));
}

run();
