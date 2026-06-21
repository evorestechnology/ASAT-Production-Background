import { supabaseAdmin } from './src/supabaseAdmin.js';

async function fixBreakdown() {
  const { data: designs, error } = await supabaseAdmin.from('designs').select('id, title, price');
  if (error) {
    console.error(error);
    return;
  }

  for (const d of designs) {
    const baseCost = Math.floor(d.price * 0.4);
    const printingCost = Math.floor(d.price * 0.2);
    const designerCost = Math.floor(d.price * 0.2);
    const markup = d.price - (baseCost + printingCost + designerCost);

    const desc = JSON.stringify({
      text: 'A great design created by our amazing designers.',
      pricing: { baseCost, printingCost, designerCost, markup }
    });

    await supabaseAdmin.from('designs').update({ description: desc }).eq('id', d.id);
  }
  
  console.log('Fixed pricing breakdowns!');
}

fixBreakdown();
