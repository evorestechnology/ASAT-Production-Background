async function main() {
  const res = await fetch('http://localhost:5000/api/settings');
  const data = await res.json();
  const rules = data.finance_cost_rules || {};
  console.log('finance_cost_rules:', JSON.stringify(rules, null, 2));
  console.log('markup_pct:', rules.markup_pct);
  console.log('packing_cost:', rules.packing_cost ?? '(not set, default 50)');
  console.log('operating_cost:', rules.operating_cost ?? '(not set, default 100)');
}
main().catch(console.error);
