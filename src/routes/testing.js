import supabaseAdmin from '../supabaseAdmin.js';

for (let i = 1; i <= 5; i++) {
  const start = performance.now();

  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id')
    .limit(1);

  console.log(
    `Run ${i}: ${(performance.now() - start).toFixed(2)} ms`
  );

  if (error) console.error(error);
}