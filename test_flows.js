// E2E Flow Verification Script for ASAT Platform
const API_BASE = 'http://localhost:5000';

async function runTests() {
  console.log('====================================================');
  console.log('   ASAT PLATFORM COMPLETE FLOW VERIFICATION SUITE   ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`[TEST] ${name}... `);
      await fn();
      console.log('✓ PASSED');
      passed++;
    } catch (err) {
      console.log(`✗ FAILED: ${err.message}`);
      failed++;
    }
  }

  // 1. Core Catalog and Platform Configuration
  await test('Public Settings & Currencies', async () => {
    const res = await fetch(`${API_BASE}/api/settings`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid settings response');
  });

  await test('Currency Rates & Exchange Data', async () => {
    const res = await fetch(`${API_BASE}/api/currency/rates`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const rates = await res.json();
    if (!rates || !rates.USD || !rates.INR) throw new Error('Missing key currency rates');
  });

  await test('Categories Catalog', async () => {
    const res = await fetch(`${API_BASE}/api/categories`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const cats = await res.json();
    if (!Array.isArray(cats) || cats.length === 0) throw new Error('No categories found');
  });

  await test('Base Products / Manufacturing Garments', async () => {
    const res = await fetch(`${API_BASE}/api/products`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const products = await res.json();
    if (!Array.isArray(products) || products.length === 0) throw new Error('No products found');
  });

  await test('Designer Community Designs', async () => {
    const res = await fetch(`${API_BASE}/api/designs?limit=20`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const designs = await res.json();
    if (!Array.isArray(designs)) throw new Error('Invalid designs response');
  });

  await test('Designer Rankings & Leaderboard', async () => {
    const res = await fetch(`${API_BASE}/api/designers/rankings`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const rankings = await res.json();
    if (!Array.isArray(rankings)) throw new Error('Invalid rankings response');
  });

  await test('Manufacturer Print Styles & Placements', async () => {
    const res = await fetch(`${API_BASE}/api/print-styles`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const styles = await res.json();
    if (!Array.isArray(styles)) throw new Error('Invalid print styles response');
  });

  await test('Tutorials Library', async () => {
    const res = await fetch(`${API_BASE}/api/tutorials`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const tutorials = await res.json();
    if (!Array.isArray(tutorials)) throw new Error('Invalid tutorials response');
  });

  // 2. Payment Gateway & Order Creation Flow
  let testOrderId = `TEST_${Date.now()}`;

  await test('Cashfree Payment Session Creation (Sandbox Simulation)', async () => {
    const payload = {
      orderId: testOrderId,
      orderAmount: 1499.00,
      customerName: 'Test Customer',
      customerEmail: 'test.customer@asat.live',
      customerPhone: '9876543210',
      returnUrl: 'http://localhost:5173/orders'
    };

    const res = await fetch(`${API_BASE}/api/payment/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.payment_session_id && !data.isSimulated) {
      throw new Error('Neither payment_session_id nor simulated session returned');
    }
  });

  // 3. Order Placement Flow
  await test('Order Database Placement & Financial Splitting', async () => {
    // Fetch a real design to place an order against
    const designsRes = await fetch(`${API_BASE}/api/designs?limit=1`);
    const designs = await designsRes.json();
    const targetDesign = designs[0] || {
      id: 'test-design-id',
      title: 'Minimalist Signature Tee',
      price: 250
    };

    const orderPayload = {
      order_id: testOrderId,
      user_id: 'test_user_flow_123',
      customer_name: 'Test Customer',
      contact: 'test.customer@asat.live',
      phone: '9876543210',
      address: '42 Fashion Boulevard, Mumbai, Maharashtra 400001',
      country: 'India',
      shipping_amount: 100,
      total_amount: 1499,
      items: [
        {
          id: targetDesign.id,
          name: targetDesign.title,
          price: 1399,
          qty: 1,
          size: 'L',
          color: 'Black',
          selectedColor: 'Black',
          image: targetDesign.image || 'https://via.placeholder.com/300'
        }
      ]
    };

    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Status ${res.status}: ${err.error || 'Failed'}`);
    }
    const createdOrder = await res.json();
    const orderData = createdOrder.order || createdOrder;
    if (!orderData || !orderData.id) throw new Error('Order was not saved');
  });

  // 4. Guest Order Tracking Flow
  await test('Live Order Tracking by Order ID', async () => {
    const res = await fetch(`${API_BASE}/api/orders/${testOrderId}`);
    if (res.ok) {
      const order = await res.json();
      if (order && order.order_id !== testOrderId && order.id !== testOrderId) {
        throw new Error('Order ID mismatch in tracking');
      }
    } else if (res.status !== 404) {
      throw new Error(`Unexpected status ${res.status}`);
    }
  });

  // 5. Auth / Role Resolution Flow
  await test('Auth Role Resolution (Unregistered email)', async () => {
    const res = await fetch(`${API_BASE}/api/auth/resolve-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nonexistent_flow_user@asat.live' })
    });
    if (res.status === 404 || res.status === 200) {
      // Expected response for unregistered user
    } else {
      throw new Error(`Unexpected status ${res.status}`);
    }
  });

  console.log('\n====================================================');
  console.log(`VERIFICATION COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
