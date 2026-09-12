import { supabaseAdmin } from './src/supabaseAdmin.js';
import { syncWalletBalance } from './src/routes/wallets.js';

const API_BASE = 'http://localhost:5000';

async function runDeepTests() {
  console.log('================================================================');
  console.log('   DEEP AUDIT: PAYMENT, WALLET & ORDER HISTORY FLOW SUITE       ');
  console.log('================================================================\n');

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

  const testOrderId = `ASAT_DEEPTEST_${Date.now()}`;
  let dbOrderRecord = null;

  // ─────────────────────────────────────────────────────────────
  // 1. PAYMENT GATEWAY FLOW
  // ─────────────────────────────────────────────────────────────
  await test('1.1 Payment Session Creation (Standard & Alternate Fields)', async () => {
    const res = await fetch(`${API_BASE}/api/payment/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 2499.50,
        customerName: 'Aarav Sharma',
        customerEmail: 'aarav@asat.live',
        customerPhone: '+91 98765 43210'
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.order_id) throw new Error('Missing order_id');
    if (!data.payment_session_id && !data.isSimulated) throw new Error('No session ID or simulated flag');
  });

  await test('1.2 Payment Session Creation (Fallback with orderAmount)', async () => {
    const res = await fetch(`${API_BASE}/api/payment/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderAmount: 1899.00,
        customerName: 'Aarav Sharma',
        customerPhone: '9876543210'
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error('Failed to create order with orderAmount');
  });

  await test('1.3 Payment Verification (Simulated & Production Sandbox)', async () => {
    const res = await fetch(`${API_BASE}/api/payment/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: 'TEST_VERIFY_ORD_123',
        isSimulated: true
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.verified || data.status !== 'PAID') throw new Error('Payment was not verified as PAID');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. ORDER HISTORY & ORDER MANAGEMENT FLOW
  // ─────────────────────────────────────────────────────────────
  await test('2.1 Initial Order Creation (Pending Status & Idempotent)', async () => {
    const orderPayload = {
      order_id: testOrderId,
      customer_name: 'Audit Customer',
      contact: 'audit@asat.live',
      phone: '9876543210',
      address: '77 Luxury Avenue, Mumbai 400050',
      country: 'India',
      shipping_amount: 150,
      total_amount: 2999,
      status: 'pending',
      items: [
        {
          id: 'test-item-01',
          name: 'Signature Oversized Heavy Tee',
          price: 2849,
          qty: 1,
          size: 'XL',
          color: 'Jet Black',
          selectedColor: 'Jet Black'
        }
      ]
    };

    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderPayload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const resJson = await res.json();
    dbOrderRecord = resJson.order || resJson;
    if (!dbOrderRecord || !dbOrderRecord.id) throw new Error('Database order record was not returned');
  });

  await test('2.2 Idempotent Order Update on Payment Confirmation', async () => {
    // Call POST /api/orders with same order_id, updating payment status to PAID
    const updatePayload = {
      order_id: testOrderId,
      payment_id: `PAY_${Date.now()}`,
      payment_status: 'PAID',
      status: 'confirmed',
      total_amount: 2999,
      items: dbOrderRecord.items
    };

    const res = await fetch(`${API_BASE}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatePayload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const resJson = await res.json();
    const updated = resJson.order || resJson;
    if (updated.id !== dbOrderRecord.id) throw new Error('ID mismatch: Order was duplicated instead of updated');
    if (updated.status !== 'confirmed') throw new Error(`Expected confirmed status, got ${updated.status}`);
  });

  await test('2.3 Retrieve Order Details by String order_id (Tracking)', async () => {
    const res = await fetch(`${API_BASE}/api/orders/${testOrderId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fetched = await res.json();
    if (fetched.order_id !== testOrderId) throw new Error('Failed to query order by human-readable order_id');
  });

  await test('2.4 Retrieve Order Details by Database UUID', async () => {
    const res = await fetch(`${API_BASE}/api/orders/${dbOrderRecord.id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fetched = await res.json();
    if (fetched.id !== dbOrderRecord.id) throw new Error('Failed to query order by database UUID');
  });

  await test('2.5 Cashfree Webhook Confirmation', async () => {
    const webhookPayload = {
      type: 'PAYMENT_SUCCESS_WEBHOOK',
      data: {
        order: { order_id: testOrderId },
        payment: { payment_status: 'SUCCESS' }
      }
    };
    const res = await fetch(`${API_BASE}/api/payment/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== 'OK') throw new Error('Webhook did not return OK');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. WALLET BALANCES & FINANCIAL SPLITTING FLOW
  // ─────────────────────────────────────────────────────────────
  await test('3.1 Wallet Balance Sync Calculation', async () => {
    // Test syncWalletBalance function
    const syncRes = await syncWalletBalance('nonexistent_designer_user_id');
    if (!syncRes || typeof syncRes.balance !== 'number') {
      throw new Error('syncWalletBalance did not return valid wallet object');
    }
    if (syncRes.balance !== 0) {
      throw new Error(`Expected balance 0 for unused ID, got ${syncRes.balance}`);
    }
  });

  await test('3.2 Financial Integrity Verification (Earnings <= Order Total)', async () => {
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('id, total_amount, designer_earnings, mfg_earnings, platform_earnings')
      .limit(10);

    for (const o of (orders || [])) {
      const total = Number(o.total_amount) || 0;
      const des = Number(o.designer_earnings) || 0;
      const mfg = Number(o.mfg_earnings) || 0;
      const plat = Number(o.platform_earnings) || 0;
      // des + mfg + plat should not exceed total
      if (des + mfg + plat > total + 1) { // allow 1 rupee rounding
        throw new Error(`Order ${o.id} split overflow: total=${total}, split=${des+mfg+plat}`);
      }
    }
  });

  // ─────────────────────────────────────────────────────────────
  // CLEANUP
  // ─────────────────────────────────────────────────────────────
  await test('Cleanup Test Order Record', async () => {
    const { error } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', dbOrderRecord.id);
    if (error) throw new Error(`Cleanup failed: ${error.message}`);
  });

  console.log('\n================================================================');
  console.log(`DEEP AUDIT COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================');
  process.exit(failed > 0 ? 1 : 0);
}

runDeepTests();
