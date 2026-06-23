async function main() {
  // Simulate Products.jsx mapping
  const designsRes = await fetch('http://localhost:5000/api/designs?limit=120');
  const designsData = await designsRes.json();

  const categoriesRes = await fetch('http://localhost:5000/api/categories');
  const categoriesData = await categoriesRes.json();

  const mapped = (designsData || []).map((d) => ({
    ...d,
    category: (() => {
      const catVal = d.products?.category || d.catalogue?.category || d.category || '';
      const match = (categoriesData || []).find(c => c.slug === catVal || c.name === catVal);
      return match ? match.name : (catVal || 'Other');
    })(),
  }));

  const cats = new Set(
    mapped.map((p) => p.category || p.type || p.productType || '').filter(Boolean)
  );
  console.log('Mapped Category for each design:', mapped.map(p => ({ title: p.title, category: p.category })));
  console.log('Unique Categories Set:', Array.from(cats));
}

main().catch(console.error);
