async function main() {
  const res = await fetch('http://localhost:5000/api/designs?limit=120');
  const data = await res.json();
  console.log('--- API DESIGNS ---');
  console.log(JSON.stringify(data, null, 2));

  const res2 = await fetch('http://localhost:5000/api/categories');
  const categories = await res2.json();
  console.log('--- API CATEGORIES ---');
  console.log(categories);
}

main().catch(console.error);
