import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth } from '../middleware/auth.js';

const router = express.Router();

const getCashfreeBaseUrl = () => {
  const env = (process.env.CASHFREE_ENV || 'TEST').toUpperCase();
  return env === 'PRODUCTION' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
};

// POST /api/payment/create-order - Create Cashfree Order & Payment Session
router.post('/create-order', verifyAuth, async (req, res) => {
  try {
    const { amount, customerName, customerEmail, customerPhone, cartItems, shippingAddress } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Valid payment amount is required.' });
    }

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const baseUrl = getCashfreeBaseUrl();
    const orderId = `ASAT_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Prepare Customer Phone (Cashfree requires 10-digit numeric or formatted phone)
    let phoneStr = (customerPhone || '9999999999').replace(/\D/g, '');
    if (phoneStr.length < 10) phoneStr = '9999999999';
    if (phoneStr.length > 10) phoneStr = phoneStr.slice(-10);

    const payload = {
      order_amount: Number(amount.toFixed(2)),
      order_currency: 'INR',
      order_id: orderId,
      customer_details: {
        customer_id: req.uid,
        customer_name: (customerName || 'ASAT Customer').trim(),
        customer_email: (customerEmail || 'customer@as-simple-as-that.com').trim(),
        customer_phone: phoneStr
      },
      order_meta: {
        return_url: `${req.headers.origin || 'http://localhost:5173'}/orders?order_id=${orderId}`
      },
      order_note: `ASAT Purchase - ${cartItems?.length || 1} item(s)`
    };

    // If using default placeholder keys, return simulated session for quick test
    if (!appId || appId === 'TEST_APP_ID' || !secretKey || secretKey === 'TEST_SECRET_KEY') {
      console.log('Cashfree API keys not set or using placeholders. Returning simulated payment session.');
      return res.json({
        success: true,
        payment_session_id: `session_simulated_${Date.now()}`,
        order_id: orderId,
        isSimulated: true,
        cfEnv: process.env.CASHFREE_ENV || 'TEST'
      });
    }

    const response = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Cashfree order creation error:', data);
      return res.status(response.status).json({
        error: data.message || 'Failed to create Cashfree payment session.',
        details: data
      });
    }

    res.json({
      success: true,
      payment_session_id: data.payment_session_id,
      order_id: data.order_id,
      cfEnv: process.env.CASHFREE_ENV || 'TEST'
    });
  } catch (err) {
    console.error('Error in Cashfree order creation:', err.message);
    res.status(500).json({ error: 'Failed to create Cashfree payment order.' });
  }
});

// POST /api/payment/verify - Verify Cashfree Payment status
router.post('/verify', verifyAuth, async (req, res) => {
  try {
    const { orderId, isSimulated } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required for verification.' });
    }

    if (isSimulated) {
      return res.json({ success: true, status: 'PAID', verified: true });
    }

    const appId = process.env.CASHFREE_APP_ID;
    const secretKey = process.env.CASHFREE_SECRET_KEY;
    const baseUrl = getCashfreeBaseUrl();

    const response = await fetch(`${baseUrl}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Cashfree verification failed:', data);
      return res.status(response.status).json({ error: data.message || 'Verification failed.' });
    }

    const isPaid = data.order_status === 'PAID';

    res.json({
      success: true,
      status: data.order_status,
      verified: isPaid,
      orderDetails: data
    });
  } catch (err) {
    console.error('Error verifying Cashfree payment:', err.message);
    res.status(500).json({ error: 'Failed to verify payment.' });
  }
});

export default router;
