import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, resolveAnyRole, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// Helper to recalculate wallet balance with eligible completed earnings and pending escrow
export const syncWalletBalance = async (userId) => {
  try {
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('*');

    let eligibleEarnings = 0;
    let pendingEarnings = 0;

    (orders || []).forEach(order => {
      // Cancelled orders produce zero earnings for anyone
      if (order.status === 'cancelled') return;

      const isDelivered = (order.status === 'completed' || order.status === 'delivered');
      const items = Array.isArray(order.items) ? order.items : [];

      // 1. Manufacturer earnings
      if (order.mfg_id === userId) {
        const mfgAmt = Number(order.mfg_earnings) || 0;
        if (isDelivered) {
          eligibleEarnings += mfgAmt;
        } else {
          pendingEarnings += mfgAmt;
        }
      }

      // 2. Designer earnings
      let designerOrderEarnings = 0;
      let matchedItems = 0;

      items.forEach(item => {
        const isItemDesigner = (item.designerId && item.designerId === userId) ||
                               (item.designer_id && item.designer_id === userId) ||
                               (!item.isMfgProduct && order.designer_id === userId);

        if (isItemDesigner) {
          matchedItems++;
          const qty = Number(item.qty) || 1;
          let royaltyPerItem = Number(item.designer_price) || Number(item.designerRoyalty) || Number(item.designerCost) || 0;
          if (royaltyPerItem > 0) {
            designerOrderEarnings += royaltyPerItem * qty;
          }
        }
      });

      let orderDesignerAmt = 0;
      if (matchedItems > 0 && designerOrderEarnings > 0) {
        orderDesignerAmt = designerOrderEarnings;
      } else if (order.designer_id === userId) {
        orderDesignerAmt = Number(order.designer_earnings) || 0;
      }

      if (orderDesignerAmt > 0) {
        if (isDelivered) {
          eligibleEarnings += orderDesignerAmt;
        } else {
          pendingEarnings += orderDesignerAmt;
        }
      }
    });

    // Get total withdrawals for this user
    const { data: withdrawals } = await supabaseAdmin
      .from('withdrawals')
      .select('amount, status')
      .eq('user_id', userId);

    let totalWithdrawn = 0;
    let pendingWithdrawals = 0;

    (withdrawals || []).forEach(w => {
      const amt = Number(w.amount) || 0;
      if (w.status === 'approved' || w.status === 'completed') {
        totalWithdrawn += amt;
      } else if (w.status === 'pending') {
        pendingWithdrawals += amt;
      }
    });

    const calculatedBalance = Math.max(0, eligibleEarnings - totalWithdrawn - pendingWithdrawals);

    const { data: updatedWallet } = await supabaseAdmin
      .from('wallets')
      .upsert({
        id: userId,
        balance: calculatedBalance,
        total_earnings: eligibleEarnings,
        total_withdrawn: totalWithdrawn
      })
      .select()
      .single();

    return {
      ...(updatedWallet || { id: userId, balance: calculatedBalance, total_earnings: eligibleEarnings, total_withdrawn: totalWithdrawn }),
      pending_balance: pendingEarnings
    };
  } catch (err) {
    console.error('Error syncing wallet balance:', err.message);
    return null;
  }
};

// GET /api/wallets/me - Get own wallet
router.get('/me', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const updatedWallet = await syncWalletBalance(req.uid);
    if (updatedWallet) {
      return res.json(updatedWallet);
    }

    const { data, error } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .eq('id', req.uid)
      .maybeSingle();

    if (error) throw error;
    
    if (!data) {
      // Initialize wallet if not exists
      const { data: newWallet, error: initError } = await supabaseAdmin
        .from('wallets')
        .insert({
          id: req.uid,
          role: req.role === 'mfg' ? 'mfg' : 'designer',
          balance: 0,
          total_spent: 0,
          total_earnings: 0,
          total_withdrawn: 0
        })
        .select()
        .single();
      
      if (initError) throw initError;
      return res.json(newWallet);
    }

    res.json(data);
  } catch (err) {
    console.error('Error fetching wallet:', err.message);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// GET /api/wallets/all - List all wallets (admin only)
router.get('/all', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('wallets')
      .select('*')
      .order('total_earnings', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching all wallets:', err.message);
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
});

// GET /api/wallets/admin-stats - Live financial metrics & ledger for Master Wallet (admin only)
router.get('/admin-stats', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    let totalRevenue = 0;
    let designerPayouts = 0;
    let mfgPayouts = 0;

    let completedRevenue = 0;
    let completedDesigner = 0;
    let completedMfg = 0;

    let pendingRevenue = 0;
    let pendingDesigner = 0;
    let pendingMfg = 0;

    const ledger = [];

    (orders || []).forEach(o => {
      const isCancelled = o.status === 'cancelled';
      const isCompleted = (o.status === 'completed' || o.status === 'delivered');
      const orderTotal = Number(o.total_amount) || 0;
      const desAmt = Number(o.designer_earnings) || 0;
      const mfgAmt = Number(o.mfg_earnings) || 0;
      const platAmt = Math.max(0, orderTotal - desAmt - mfgAmt);

      ledger.push({
        id: o.id,
        orderId: o.order_id || o.id,
        date: o.created_at,
        status: o.status,
        customer: o.customer_name || 'Customer',
        country: o.country || 'India',
        totalAmount: orderTotal,
        designerEarnings: desAmt,
        mfgEarnings: mfgAmt,
        platformEarnings: platAmt,
        isCancelled,
        isCompleted
      });

      if (isCancelled) return; // Exclude cancelled orders from active realized totals

      totalRevenue += orderTotal;
      designerPayouts += desAmt;
      mfgPayouts += mfgAmt;

      if (isCompleted) {
        completedRevenue += orderTotal;
        completedDesigner += desAmt;
        completedMfg += mfgAmt;
      } else {
        pendingRevenue += orderTotal;
        pendingDesigner += desAmt;
        pendingMfg += mfgAmt;
      }
    });

    const platformEarnings = Math.max(0, totalRevenue - designerPayouts - mfgPayouts);
    const completedPlatform = Math.max(0, completedRevenue - completedDesigner - completedMfg);
    const pendingPlatform = Math.max(0, pendingRevenue - pendingDesigner - pendingMfg);

    res.json({
      totalRevenue,
      designerPayouts,
      mfgPayouts,
      platformEarnings,
      completed: {
        revenue: completedRevenue,
        designer: completedDesigner,
        mfg: completedMfg,
        platform: completedPlatform
      },
      pending: {
        revenue: pendingRevenue,
        designer: pendingDesigner,
        mfg: pendingMfg,
        platform: pendingPlatform
      },
      ledger
    });
  } catch (err) {
    console.error('Error fetching admin wallet stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// GET /api/wallets/ledger - Get personal order earnings breakdown (for mfg or designer)
router.get('/ledger', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const ledger = [];
    (orders || []).forEach(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      if (req.role === 'mfg' && order.mfg_id === req.uid) {
        const isDelivered = (order.status === 'completed' || order.status === 'delivered');
        const isCancelled = order.status === 'cancelled';
        ledger.push({
          id: order.id,
          orderId: order.order_id || order.id,
          date: order.created_at,
          customer: order.customer_name || 'Customer',
          itemsCount: items.reduce((s, i) => s + (Number(i.qty) || 1), 0),
          amount: Number(order.mfg_earnings) || 0,
          status: order.status,
          isCancelled,
          isDelivered,
          settlementStatus: isCancelled ? 'Cancelled' : isDelivered ? 'Credited to Balance' : 'In Production / Escrow'
        });
      } else if (req.role === 'designer') {
        let designerOrderEarnings = 0;
        let matched = false;
        items.forEach(item => {
          if (item.designerId === req.uid || item.designer_id === req.uid || (!item.isMfgProduct && order.designer_id === req.uid)) {
            matched = true;
            const qty = Number(item.qty) || 1;
            const r = Number(item.designer_price) || Number(item.designerRoyalty) || Number(item.designerCost) || 0;
            designerOrderEarnings += r * qty;
          }
        });
        if (!matched && order.designer_id === req.uid) {
          matched = true;
          designerOrderEarnings = Number(order.designer_earnings) || 0;
        }
        if (matched) {
          const isDelivered = (order.status === 'completed' || order.status === 'delivered');
          const isCancelled = order.status === 'cancelled';
          ledger.push({
            id: order.id,
            orderId: order.order_id || order.id,
            date: order.created_at,
            customer: order.customer_name || 'Customer',
            itemsCount: items.reduce((s, i) => s + (Number(i.qty) || 1), 0),
            amount: designerOrderEarnings,
            status: order.status,
            isCancelled,
            isDelivered,
            settlementStatus: isCancelled ? 'Cancelled' : isDelivered ? 'Credited to Balance' : 'In Production / Escrow'
          });
        }
      }
    });

    res.json(ledger);
  } catch (err) {
    console.error('Error fetching personal ledger:', err.message);
    res.status(500).json({ error: 'Failed to fetch personal ledger' });
  }
});

// GET /api/wallets/withdrawals - Get own withdrawals history
router.get('/withdrawals', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('user_id', req.uid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching withdrawals:', err.message);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// GET /api/wallets/withdrawals/all - Get all withdrawals (admin only)
router.get('/withdrawals/all', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching all withdrawals:', err.message);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// POST /api/wallets/withdraw - Submit withdrawal request
router.post('/withdraw', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { amount, paymentMethod, paymentId } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ error: 'Please enter a valid amount.' });
    }

    // Sync wallet first to verify true live balance
    const liveWallet = await syncWalletBalance(req.uid);
    const balance = liveWallet ? Number(liveWallet.balance) : 0;

    if (amt > balance) {
      return res.status(400).json({ error: `Insufficient withdrawable balance. Available: ₹${balance.toLocaleString('en-IN')}` });
    }

    // Insert withdrawal request
    const username = req.roleData?.username || req.roleData?.business_name || (req.user?.email ? req.user.email.split('@')[0] : 'User');
    const withdrawalPayload = {
      user_id: req.uid,
      username,
      role: req.role === 'mfg' ? 'mfg' : 'designer',
      amount: amt,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    let { data, error } = await supabaseAdmin
      .from('withdrawals')
      .insert(withdrawalPayload)
      .select()
      .single();

    if (error) throw error;

    // Immediately resync wallet to subtract this pending withdrawal from available balance
    await syncWalletBalance(req.uid);

    res.json({ success: true, withdrawal: data });
  } catch (err) {
    console.error('Error submitting withdrawal request:', err.message);
    res.status(500).json({ error: 'Failed to process withdrawal request' });
  }
});

// PUT /api/wallets/withdrawals/:id - Approve or reject withdrawal request (admin only)
router.put('/withdrawals/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body; // status is 'approved' or 'rejected'

    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Valid status ("approved" or "rejected") is required.' });
    }

    // Fetch withdrawal request
    const { data: wRequest, error: fetchErr } = await supabaseAdmin
      .from('withdrawals')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !wRequest) {
      return res.status(404).json({ error: 'Withdrawal request not found.' });
    }

    if (wRequest.status !== 'pending') {
      return res.status(400).json({ error: 'Withdrawal request is already processed.' });
    }

    if (status === 'approved') {
      // Approve withdrawal: Deduct balance, increment total_withdrawn
      const { data: wallet, error: walletErr } = await supabaseAdmin
        .from('wallets')
        .select('balance, total_withdrawn')
        .eq('id', wRequest.user_id)
        .single();

      if (walletErr || !wallet) {
        return res.status(404).json({ error: 'Wallet not found.' });
      }

      if (Number(wallet.balance) < Number(wRequest.amount)) {
        return res.status(400).json({ error: 'Insufficient balance to approve withdrawal.' });
      }

      const newBalance = Number(wallet.balance) - Number(wRequest.amount);
      const newWithdrawn = Number(wallet.total_withdrawn) + Number(wRequest.amount);

      const { error: updateWalletErr } = await supabaseAdmin
        .from('wallets')
        .update({
          balance: newBalance,
          total_withdrawn: newWithdrawn
        })
        .eq('id', wRequest.user_id);

      if (updateWalletErr) throw updateWalletErr;
    }

    // Update withdrawal request status
    const updatePayload = {
      status,
      processed_at: new Date().toISOString(),
      processed_by: req.uid
    };
    
    // Check if rejection_reason exists as a column or just handle it if it fails.
    // Wait, the table in schema doesn't have rejection_reason. But to be safe,
    // let's check if the column is present, or try writing it inside a try-catch.
    // Alternatively, let's omit it if it's not in our schema, or let's select it first.
    // Let's look at what columns are returned or just omit it to avoid database error,
    // or keep it in metadata. Let's just update standard columns to avoid database error.
    
    const { data, error: updateErr } = await supabaseAdmin
      .from('withdrawals')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Resync user's wallet so pending vs withdrawn vs balance are strictly accurate
    await syncWalletBalance(wRequest.user_id);

    res.json({ success: true, withdrawal: data });
  } catch (err) {
    console.error('Error processing withdrawal:', err.message);
    res.status(500).json({ error: 'Failed to process withdrawal request' });
  }
});

// GET /api/wallets/sales-history - Get detailed history of sold designs for designer
router.get('/sales-history', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const designerId = req.uid;

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const salesHistory = [];

    (orders || []).forEach(order => {
      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach(item => {
        const isItemDesigner = (item.designerId && item.designerId === designerId) ||
                               (item.designer_id && item.designer_id === designerId) ||
                               (!item.isMfgProduct && order.designer_id === designerId);

        if (isItemDesigner) {
          const qty = Number(item.qty) || 1;
          const itemPrice = Number(item.price) || 0;
          let royaltyPerItem = Number(item.designer_price) || Number(item.designerRoyalty) || Number(item.designerCost) || 0;
          if (!royaltyPerItem) {
            royaltyPerItem = Math.round((Number(order.designer_earnings) || 0) / (items.length || 1) / qty);
          }
          const totalEarned = royaltyPerItem * qty;
          const isDelivered = (order.status === 'completed' || order.status === 'delivered');

          salesHistory.push({
            id: `${order.id}_${item.id || item.name}`,
            orderId: order.order_id || order.id,
            designId: item.id || null,
            title: item.name || 'Custom Design',
            image: item.image || item.frontImage || item.coverImage || '',
            size: item.size || 'Standard',
            color: item.colorName || item.color || 'Standard',
            quantity: qty,
            customerName: order.customer_name || 'Customer',
            country: order.country || 'India',
            date: order.created_at,
            deliveredAt: isDelivered ? (order.delivered_at || order.updated_at || order.created_at) : null,
            status: order.status || 'pending',
            royaltyPerItem: royaltyPerItem,
            totalEarned: totalEarned,
            isDelivered: isDelivered,
            earningsStatus: isDelivered ? 'Credited to Wallet' : 'Pending Delivery'
          });
        }
      });
    });

    res.json(salesHistory);
  } catch (err) {
    console.error('Error fetching sales history:', err.message);
    res.status(500).json({ error: 'Failed to fetch sales history' });
  }
});

export default router;
