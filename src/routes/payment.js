import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

const getCashfreeBaseUrl = () => {
  const env = (process.env.CASHFREE_ENV || 'PRODUCTION').toUpperCase();
  return env === 'PRODUCTION' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
};

// POST /api/payment/create-order - Create Cashfree Order & Payment Session
router.post('/create-order', optionalAuth, async (req, res) => {
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

    let originUrl = req.headers.origin || 'https://asat-production-frontend.vercel.app';
    let returnUrl = `${originUrl}/orders?order_id=${orderId}`;
    if (returnUrl.startsWith('http://') && !returnUrl.includes('localhost')) {
      returnUrl = returnUrl.replace('http://', 'https://');
    }

    const payload = {
      order_amount: Number(amount.toFixed(2)),
      order_currency: 'INR',
      order_id: orderId,
      customer_details: {
        customer_id: req.uid || `guest_${Date.now()}`,
        customer_name: (customerName || 'ASAT Customer').trim(),
        customer_email: (customerEmail || 'customer@as-simple-as-that.com').trim(),
        customer_phone: phoneStr
      },
      order_meta: {
        return_url: returnUrl
      },
      order_note: `ASAT Purchase - ${cartItems?.length || 1} item(s)`
    };

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
      cfEnv: process.env.CASHFREE_ENV || 'PRODUCTION'
    });
  } catch (err) {
    console.error('Error in Cashfree order creation:', err.message);
    res.status(500).json({ error: 'Failed to create Cashfree payment order.' });
  }
});

// POST /api/payment/verify - Verify Cashfree Payment status
router.post('/verify', optionalAuth, async (req, res) => {
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

    // 1. Fetch Order Status
    const orderRes = await fetch(`${baseUrl}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'x-client-id': appId,
        'x-client-secret': secretKey,
        'x-api-version': '2023-08-01'
      }
    });

    const orderData = await orderRes.json();

    if (!orderRes.ok) {
      console.error('Cashfree verification failed:', orderData);
      return res.status(orderRes.status).json({ error: orderData.message || 'Verification failed.' });
    }

    const isPaid = orderData.order_status === 'PAID';

    // 2. Fetch Payment details (UPI / Card / Netbanking details if paid)
    let paymentDetails = null;
    if (isPaid) {
      try {
        const paymentsRes = await fetch(`${baseUrl}/orders/${orderId}/payments`, {
          method: 'GET',
          headers: {
            'x-client-id': appId,
            'x-client-secret': secretKey,
            'x-api-version': '2023-08-01'
          }
        });
        if (paymentsRes.ok) {
          const paymentsList = await paymentsRes.json();
          paymentDetails = Array.isArray(paymentsList) ? paymentsList[0] : paymentsList;
        }
      } catch (pErr) {
        console.error('Failed to fetch Cashfree payments list:', pErr.message);
      }
    }

    res.json({
      success: true,
      status: orderData.order_status,
      verified: isPaid,
      orderDetails: orderData,
      paymentDetails
    });
  } catch (err) {
    console.error('Error verifying Cashfree payment:', err.message);
    res.status(500).json({ error: 'Failed to verify payment.' });
  }
});

// POST /api/payment/webhook - Cashfree Webhook Notifications
router.post('/webhook', async (req, res) => {
  try {
    const rawData = req.body;
    console.log('🔔 Received Cashfree Webhook Notification:', JSON.stringify(rawData));

    // Handle Cashfree PG v3 Webhook event payload
    const orderId = rawData?.data?.order?.order_id || rawData?.orderId || rawData?.order_id;
    const paymentStatus = rawData?.data?.payment?.payment_status || rawData?.payment_status || rawData?.type;

    if (orderId && (paymentStatus === 'SUCCESS' || paymentStatus === 'PAYMENT_SUCCESS_WEBHOOK')) {
      console.log(`✅ Webhook confirmed payment for order: ${orderId}`);
      
      // Update order payment status in database
      const { error: updateErr } = await supabaseAdmin
        .from('orders')
        .update({
          payment_status: 'PAID',
          status: 'confirmed'
        })
        .eq('order_id', orderId);

      if (updateErr) {
        console.error(`Error updating order ${orderId} via webhook:`, updateErr.message);
      }
    }

    // Cashfree expects HTTP 200 response to acknowledge webhook delivery
    res.status(200).json({ status: 'OK' });
  } catch (err) {
    console.error('Cashfree Webhook Handler Error:', err.message);
    res.status(200).json({ status: 'OK' });
  }
});

export default router;
