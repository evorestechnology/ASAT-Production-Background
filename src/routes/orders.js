import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, resolveAnyRole } from '../middleware/auth.js';

const router = express.Router();

async function updateWallet(role, userId, earnings) {
  if (!userId || !earnings) return;
  try {
    const { data: wallet } = await supabaseAdmin.from('wallets').select('*').eq('id', userId).single();
    if (wallet) {
      await supabaseAdmin.from('wallets').update({
        balance: Number(wallet.balance || 0) + Number(earnings),
        total_earnings: Number(wallet.total_earnings || 0) + Number(earnings)
      }).eq('id', userId);
    } else {
      await supabaseAdmin.from('wallets').insert({
        id: userId,
        role: role,
        balance: Number(earnings),
        total_earnings: Number(earnings),
        total_spent: 0,
        total_withdrawn: 0
      });
    }
  } catch(e) {
    console.error('Wallet update error:', e.message);
  }
}


// GET /api/orders - Get orders matching logged-in user role
router.get('/', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { history } = req.query;
    const uid = req.uid;
    const role = req.role;

    let query = supabaseAdmin.from('orders').select('*');

    if (role === 'admin') {
      // Admin sees all
      query = query.order('created_at', { ascending: false });
    } else if (role === 'designer') {
      // Designer sees their orders
      query = query.eq('designer_id', uid).order('created_at', { ascending: false });
    } else if (role === 'mfg') {
      // Mfg sees assigned or unassigned active orders (if active)
      if (history === 'true') {
        query = query
          .eq('mfg_id', uid)
          .in('status', ['completed', 'cancelled'])
          .order('created_at', { ascending: false });
      } else {
        // active orders: not completed, not cancelled, AND (mfg_id is NULL or mfg_id = uid)
        // Wait, standard supabase doesn't support complex OR filters easily without .or().
        // Let's fetch all and filter in memory, or use a custom .or query.
        // Let's filter via .or('mfg_id.eq.' + uid + ',mfg_id.is.null') and not status.in.(completed,cancelled)
        query = query
          .or(`mfg_id.eq.${uid},mfg_id.is.null`)
          .not('status', 'in', '("completed","cancelled")')
          .order('created_at', { ascending: false });
      }
    } else if (role === 'user') {
      // Customer sees their own orders
      query = query.eq('user_id', uid).order('created_at', { ascending: false });
    } else {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching orders:', err.message);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/orders/all - Admin only
router.get('/all', verifyAuth, async (req, res, next) => {
  // Let's resolve role and verify admin
  try {
    const { data: admin } = await supabaseAdmin.from('admins').select('*').eq('id', req.uid).maybeSingle();
    if (!admin) return res.status(403).json({ error: 'Admin access required' });
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error listing all orders:', err.message);
    res.status(500).json({ error: 'Failed to retrieve orders' });
  }
});

// GET /api/orders/:id - Get single order details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // We search by either id (UUID) or order_id (human readable)
    const column = id.length === 36 ? 'id' : 'order_id';

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq(column, id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Public tracking access: let anybody see the basic details if they have order ID
    res.json(data);
  } catch (err) {
    console.error('Error fetching order details:', err.message);
    res.status(500).json({ error: 'Failed to fetch order details' });
  }
});

// POST /api/orders - Place a new order
router.post('/', async (req, res) => {
  try {
    const {
      order_id,
      user_id,
      customer_name,
      items,
      total_amount,
      designer_earnings,
      mfg_earnings,
      designer_id,
      designer_username,
      mfg_id,
      contact,
      phone,
      address,
      country
    } = req.body;

    if (!order_id || !items || !total_amount) {
      return res.status(400).json({ error: 'Required fields: order_id, items, total_amount' });
    }

    const payload = {
      order_id,
      user_id: user_id || null,
      customer_name,
      items,
      total_amount,
      designer_earnings: designer_earnings || 0,
      mfg_earnings: mfg_earnings || 0,
      designer_id: designer_id || null,
      designer_username: designer_username || 'anonymous',
      mfg_id: mfg_id || null,
      status: 'pending',
      contact: contact || '',
      phone: phone || '',
      address: address || '',
      country: country || 'India',
      tracking_id: '',
      status_history: [{ status: 'pending', time: new Date().toISOString() }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('orders')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    // Award points to designer (10 points per qty)
    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (!item.isMfgProduct && item.designerId) {
          const pointsToAdd = (Number(item.qty) || 1) * 10;
          try {
            const { data: dData } = await supabaseAdmin
              .from('designers')
              .select('points')
              .eq('id', item.designerId)
              .maybeSingle();
            
            const currentPoints = dData ? (Number(dData.points) || 0) : 0;
            await supabaseAdmin
              .from('designers')
              .update({ points: currentPoints + pointsToAdd })
              .eq('id', item.designerId);
          } catch (err) {
            console.error('Error awarding designer points:', err.message);
          }
        }
      }
    }

    // Update wallets
    if (payload.designer_id && payload.designer_earnings) {
      await updateWallet('designer', payload.designer_id, payload.designer_earnings);
    }
    if (payload.mfg_id && payload.mfg_earnings) {
      await updateWallet('mfg', payload.mfg_id, payload.mfg_earnings);
    }

    res.json({ success: true, order: data });
  } catch (err) {
    console.error('Error placing order:', err.message);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// PUT /api/orders/:id - Update order status, tracking ID, or manufacturer
router.put('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, tracking_id, mfg_id } = req.body;

    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const payload = {
      updated_at: new Date().toISOString()
    };

    // Determine authorization and assign values
    if (req.role === 'admin') {
      if (status !== undefined) payload.status = status;
      if (tracking_id !== undefined) payload.tracking_id = tracking_id;
      if (mfg_id !== undefined) payload.mfg_id = mfg_id;
    } else if (req.role === 'mfg') {
      // Manufacturer can assign to self if unassigned, or update status/tracking if assigned
      if (order.mfg_id && order.mfg_id !== req.uid) {
        return res.status(403).json({ error: 'Order is already assigned to another manufacturer.' });
      }
      
      // If newly claiming an order that was unassigned, update their wallet
      if (!order.mfg_id) {
        await updateWallet('mfg', req.uid, order.mfg_earnings);
      }

      payload.mfg_id = req.uid; // Set/Ensure it's assigned to this mfg
      
      if (status !== undefined) payload.status = status;
      if (tracking_id !== undefined) payload.tracking_id = tracking_id;
    } else {
      return res.status(403).json({ error: 'Unauthorized to update order.' });
    }

    // Append to status history if status changed
    if (status && status !== order.status) {
      const history = Array.isArray(order.status_history) ? order.status_history : [];
      payload.status_history = [...history, { status, time: new Date().toISOString() }];
      
      if (status === 'completed') {
        payload.completed_at = new Date().toISOString();
      } else if (status === 'shipping') {
        payload.shipped_at = new Date().toISOString();
      }
    }

    const { data: updatedOrder, error } = await supabaseAdmin
      .from('orders')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Wallet balance credits/deductions
    const oldStatus = order.status;
    const newStatus = updatedOrder.status;

    if (oldStatus !== 'completed' && newStatus === 'completed') {
      // Credit Manufacturer Wallet
      if (updatedOrder.mfg_id && updatedOrder.mfg_earnings) {
        const { data: mfgWallet } = await supabaseAdmin
          .from('wallets')
          .select('balance, total_earnings')
          .eq('id', updatedOrder.mfg_id)
          .maybeSingle();

        if (mfgWallet) {
          await supabaseAdmin
            .from('wallets')
            .update({
              balance: Number(mfgWallet.balance || 0) + Number(updatedOrder.mfg_earnings || 0),
              total_earnings: Number(mfgWallet.total_earnings || 0) + Number(updatedOrder.mfg_earnings || 0)
            })
            .eq('id', updatedOrder.mfg_id);
        }
      }

      // Credit Designer Wallet
      if (updatedOrder.designer_id && updatedOrder.designer_earnings) {
        const { data: desWallet } = await supabaseAdmin
          .from('wallets')
          .select('balance, total_earnings')
          .eq('id', updatedOrder.designer_id)
          .maybeSingle();

        if (desWallet) {
          await supabaseAdmin
            .from('wallets')
            .update({
              balance: Number(desWallet.balance || 0) + Number(updatedOrder.designer_earnings || 0),
              total_earnings: Number(desWallet.total_earnings || 0) + Number(updatedOrder.designer_earnings || 0)
            })
            .eq('id', updatedOrder.designer_id);
        }
      }
    } else if (oldStatus === 'completed' && newStatus !== 'completed') {
      // Reverted from completed: Deduct Manufacturer Wallet
      if (updatedOrder.mfg_id && updatedOrder.mfg_earnings) {
        const { data: mfgWallet } = await supabaseAdmin
          .from('wallets')
          .select('balance, total_earnings')
          .eq('id', updatedOrder.mfg_id)
          .maybeSingle();

        if (mfgWallet) {
          await supabaseAdmin
            .from('wallets')
            .update({
              balance: Math.max(0, Number(mfgWallet.balance || 0) - Number(updatedOrder.mfg_earnings || 0)),
              total_earnings: Math.max(0, Number(mfgWallet.total_earnings || 0) - Number(updatedOrder.mfg_earnings || 0))
            })
            .eq('id', updatedOrder.mfg_id);
        }
      }

      // Deduct Designer Wallet
      if (updatedOrder.designer_id && updatedOrder.designer_earnings) {
        const { data: desWallet } = await supabaseAdmin
          .from('wallets')
          .select('balance, total_earnings')
          .eq('id', updatedOrder.designer_id)
          .maybeSingle();

        if (desWallet) {
          await supabaseAdmin
            .from('wallets')
            .update({
              balance: Math.max(0, Number(desWallet.balance || 0) - Number(updatedOrder.designer_earnings || 0)),
              total_earnings: Math.max(0, Number(desWallet.total_earnings || 0) - Number(updatedOrder.designer_earnings || 0))
            })
            .eq('id', updatedOrder.designer_id);
        }
      }
    }

    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error('Error updating order:', err.message);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

export default router;
