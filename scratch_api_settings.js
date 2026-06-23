async function main() {
  const res = await fetch('http://localhost:5000/api/settings');
  const data = await res.json();
  console.log('--- API SETTINGS ---');
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
