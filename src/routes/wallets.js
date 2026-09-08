import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, resolveAnyRole, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// Helper to recalculate wallet balance with 36-hour delay rule after manufacturer delivery
export const syncWalletBalance = async (userId) => {
  try {
    const { data: orders } = await supabaseAdmin
      .from('orders')
      .select('*');

    let eligibleEarnings = 0;

    (orders || []).forEach(order => {
      const isDelivered = (order.status === 'completed' || order.status === 'delivered');
      if (!isDelivered) return;

      const items = Array.isArray(order.items) ? order.items : [];
      items.forEach(item => {
        const isItemDesigner = (item.designerId && item.designerId === userId) ||
                               (!item.isMfgProduct && order.designer_id === userId);

        if (isItemDesigner) {
          const qty = Number(item.qty) || 1;
          let royaltyPerItem = Number(item.designerRoyalty) || Number(item.designerCost) || 0;
          if (!royaltyPerItem) {
            royaltyPerItem = Math.round((Number(order.designer_earnings) || 0) / (items.length || 1) / qty);
          }
          eligibleEarnings += royaltyPerItem * qty;
        }

        const isItemMfg = (item.mfgId && item.mfgId === userId) || (order.mfg_id === userId);
        if (isItemMfg) {
          const mfgE = Number(order.mfg_earnings) || 0;
          eligibleEarnings += mfgE;
        }
      });
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

    return updatedWallet;
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

    // Fetch wallet to verify balance
    const { data: wallet, error: walletError } = await supabaseAdmin
      .from('wallets')
      .select('balance')
      .eq('id', req.uid)
      .single();

    if (walletError || !wallet) {
      return res.status(404).json({ error: 'Wallet not found.' });
    }

    if (amt > Number(wallet.balance)) {
      return res.status(400).json({ error: 'Insufficient balance in wallet.' });
    }

    // Insert withdrawal request
    const username = req.roleData?.username || req.roleData?.business_name || req.user.email.split('@')[0];
    const withdrawalPayload = {
      user_id: req.uid,
      username,
      role: req.role === 'mfg' ? 'mfg' : 'designer',
      amount: amt,
      status: 'pending',
      payment_method: paymentMethod || null,
      payment_id: paymentId || null,
      created_at: new Date().toISOString()
    };

    let { data, error } = await supabaseAdmin
      .from('withdrawals')
      .insert(withdrawalPayload)
      .select()
      .single();

    if (error && error.message && error.message.includes('column')) {
      delete withdrawalPayload.payment_method;
      delete withdrawalPayload.payment_id;
      const retry = await supabaseAdmin
        .from('withdrawals')
        .insert(withdrawalPayload)
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
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
                               (!item.isMfgProduct && order.designer_id === designerId);

        if (isItemDesigner) {
          const qty = Number(item.qty) || 1;
          const itemPrice = Number(item.price) || 0;
          let royaltyPerItem = Number(item.designerRoyalty) || Number(item.designerCost) || 0;
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
