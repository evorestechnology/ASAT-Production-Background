import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, resolveAnyRole } from '../middleware/auth.js';
import { sendOrderCancellationEmail } from '../utils/mailer.js';

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

    let query = supabaseAdmin.from('orders').select('*, users(email)');

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
      .select('*, users(email)')
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
      .select('*, users(email)')
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

    const shipping_amount = Number(req.body.shipping_amount) || 0;
    let computedMfgEarnings = shipping_amount;
    let computedDesignerEarnings = 0;

    if (items && Array.isArray(items)) {
      for (const item of items) {
        const qty = Number(item.qty) || 1;
        const itemPrice = Number(item.price) || 0;

        if (item.isMfgProduct) {
          computedMfgEarnings += itemPrice * qty;
        } else {
          try {
            const { data: design, error: dErr } = await supabaseAdmin
              .from('designs')
              .select('*')
              .eq('id', item.id)
              .single();

            if (design && !dErr) {
              const desc = typeof design.description === 'string' ? JSON.parse(design.description) : design.description;
              const pricing = desc?.pricing || {};

              const baseCost = Number(pricing.baseCost) || 0;
              const printingCost = Number(pricing.printingCost) || 0;
              const designerCost = Number(pricing.designerCost) || 0;

              let actualPrintingCost = printingCost;

              // Check if selected color has light garment mode
              const bpId = design.base_product_id;
              if (bpId) {
                const { data: baseProduct, error: bpErr } = await supabaseAdmin
                  .from('products')
                  .select('*')
                  .eq('id', bpId)
                  .single();

                if (baseProduct && !bpErr) {
                  const colors = Array.isArray(baseProduct.colors) ? baseProduct.colors : [];
                  const matchedColor = colors.find(c => c.colorName === item.colorName);
                  if (matchedColor && matchedColor.mode === 'light') {
                    // Selected color is a light garment!
                    // Let's compute actual light garment cost for DTG style placements
                    const placements = desc?.placements?.[item.colorName] || [];
                    let lightPrintingCost = 0;
                    let darkPrintingCost = 0;

                    for (const placement of placements) {
                      const styleName = placement.style || '';
                      const placementId = placement.placementId || '';

                      const printingStyles = Array.isArray(baseProduct.printing_styles) ? baseProduct.printing_styles : [];
                      const ps = printingStyles.find(x => x.style?.toLowerCase() === styleName.toLowerCase());
                      if (ps) {
                        const pl = (ps.placements || []).find(p => p.id === placementId);
                        if (pl) {
                          if (styleName.toLowerCase() === 'dtg') {
                            lightPrintingCost += Number(pl.cost_light) || 0;
                            darkPrintingCost += Number(pl.cost_dark) || 0;
                          } else {
                            lightPrintingCost += Number(pl.price) || 0;
                            darkPrintingCost += Number(pl.price) || 0;
                          }
                        }
                      }
                    }

                    if (darkPrintingCost > lightPrintingCost) {
                      actualPrintingCost = lightPrintingCost;
                    }
                  }
                }
              }

              computedMfgEarnings += (baseCost + actualPrintingCost) * qty;
              computedDesignerEarnings += designerCost * qty;
            } else {
              computedDesignerEarnings += Math.round(itemPrice * qty * 0.1);
              computedMfgEarnings += Math.round(itemPrice * qty * 0.4);
            }
          } catch (err) {
            console.error("Error calculating item earnings on backend:", err);
            computedDesignerEarnings += Math.round(itemPrice * qty * 0.1);
            computedMfgEarnings += Math.round(itemPrice * qty * 0.4);
          }
        }
      }
    }

    const computedPlatformEarnings = Math.max(0, total_amount - computedMfgEarnings - computedDesignerEarnings);

    const initialStatus = req.body.status || (req.body.payment_status === 'PAID' ? 'confirmed' : 'pending');

    const payload = {
      order_id,
      user_id: user_id || null,
      customer_name,
      items,
      total_amount,
      designer_earnings: computedDesignerEarnings,
      mfg_earnings: computedMfgEarnings,
      platform_earnings: computedPlatformEarnings,
      designer_id: designer_id || null,
      designer_username: designer_username || 'anonymous',
      mfg_id: mfg_id || null,
      status: initialStatus,
      contact: contact || '',
      phone: phone || '',
      address: address || '',
      country: country || 'India',
      tracking_id: '',
      status_history: [{ status: initialStatus, time: new Date().toISOString() }],
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

    // Wallet balance is NOT updated on order creation (only when status becomes completed/delivered)

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
    const { status, tracking_id, shipping_partner, mfg_id, cant_be_done_reason, termination_reason } = req.body;

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

    // Format tracking_id if shipping_partner is provided
    let finalTrackingId = tracking_id;
    if (shipping_partner) {
      const code = tracking_id ? tracking_id.replace(/^\[[^\]]+\]\s*/, '') : '';
      finalTrackingId = `[${shipping_partner.trim()}] ${code}`.trim();
    }

    // If manufacturer reported "Can't Be Done", keep status as 'issue_reported' (pending admin review)
    // Admin will approve/reject via the separate /approve-cancellation endpoint
    let finalStatus = status;
    if (req.role === 'mfg' && (cant_be_done_reason || status === 'cant_be_done')) {
      finalStatus = 'issue_reported';
    }

    // Determine authorization and assign values
    if (req.role === 'admin') {
      if (finalStatus !== undefined) payload.status = finalStatus;
      if (finalTrackingId !== undefined) payload.tracking_id = finalTrackingId;
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
      
      if (finalStatus !== undefined) payload.status = finalStatus;
      if (finalTrackingId !== undefined) payload.tracking_id = finalTrackingId;
    } else {
      return res.status(403).json({ error: 'Unauthorized to update order.' });
    }

    // Append to status history if status changed or issue reported / terminated
    if ((finalStatus && finalStatus !== order.status) || cant_be_done_reason || termination_reason) {
      const history = Array.isArray(order.status_history) ? order.status_history : [];
      const historyEntry = { 
        status: finalStatus || order.status, 
        time: new Date().toISOString()
      };
      if (cant_be_done_reason) historyEntry.cant_be_done_reason = cant_be_done_reason;
      if (termination_reason) historyEntry.termination_reason = termination_reason;
      if (shipping_partner) historyEntry.shipping_partner = shipping_partner;

      payload.status_history = [...history, historyEntry];
      
      if (finalStatus === 'completed' || finalStatus === 'delivered') {
        payload.completed_at = new Date().toISOString();
        if (!order.delivered_at) {
          payload.delivered_at = new Date().toISOString();
        }
      } else if (finalStatus === 'shipping') {
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

    // Send Cancellation Email to Customer if order became cancelled
    if (updatedOrder.status === 'cancelled' && order.status !== 'cancelled') {
      try {
        let recipientEmail = order.contact || order.customer_email;
        if (!recipientEmail && order.user_id) {
          const { data: userData } = await supabaseAdmin
            .from('users')
            .select('email')
            .eq('id', order.user_id)
            .single();
          if (userData && userData.email) {
            recipientEmail = userData.email;
          }
        }
        if (recipientEmail) {
          const reasonText = cant_be_done_reason || termination_reason || 'Manufacturing constraint';
          const orderNum = updatedOrder.order_id || updatedOrder.id?.slice(0, 10).toUpperCase();
          await sendOrderCancellationEmail(recipientEmail, orderNum, reasonText);
        }
      } catch (mailErr) {
        console.error('Failed to trigger order cancellation email:', mailErr.message);
      }
    }

    // Wallet balance credits/deductions (only credited when order status is completed or delivered)
    const oldStatus = order.status;
    const newStatus = updatedOrder.status;

    const isDone = (s) => s === 'completed' || s === 'delivered';
    const wasDone = isDone(oldStatus);
    const isNowDone = isDone(newStatus);

    if (!wasDone && isNowDone) {
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
    } else if (wasDone && !isNowDone) {
      // Reverted from completed/delivered: Deduct Manufacturer Wallet
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

// Manufacturer requests cost adjustment (extra amount)
router.post('/:id/cost-adjustment', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, reason } = req.body;

    if (req.role !== 'mfg' && req.role !== 'admin') {
      return res.status(403).json({ error: 'Only manufacturers can request cost adjustments.' });
    }

    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ error: 'Please enter a valid extra cost amount.' });
    }

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const history = Array.isArray(order.status_history) ? order.status_history : [];
    const historyEntry = {
      type: 'cost_adjustment_request',
      amount: numAmount,
      reason: reason || 'Manufacturer cost adjustment',
      time: new Date().toISOString()
    };

    const payload = {
      cost_adjustment_status: 'requested',
      cost_adjustment_amount: numAmount,
      cost_adjustment_reason: reason || '',
      status_history: [...history, historyEntry],
      updated_at: new Date().toISOString()
    };

    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Create a support ticket to transmit request to Master Tickets module as well
    try {
      const orderRef = order.order_id || order.id;
      const { data: ticket } = await supabaseAdmin
        .from('tickets')
        .insert({
          user_id: req.uid,
          subject: `Cost Adjustment Request - Order #${orderRef}`,
          category: 'Cost Adjustment Request',
          order_id: orderRef,
          status: 'open',
          last_reply: 'user',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (ticket) {
        await supabaseAdmin
          .from('ticket_messages')
          .insert({
            ticket_id: ticket.id,
            sender_id: req.uid,
            sender_role: 'mfg',
            text: `Manufacturer requested a cost adjustment of ₹${numAmount} for Order #${orderRef}. Reason: ${reason || 'Manufacturing cost adjustment'}`
          });
      }
    } catch (tErr) {
      console.error('Failed to create ticket for cost adjustment:', tErr.message);
    }

    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error('Error submitting cost adjustment:', err.message);
    res.status(500).json({ error: 'Failed to submit cost adjustment request.' });
  }
});

// Master Admin accepts or rejects cost adjustment
router.post('/:id/cost-adjustment/review', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { action, reject_reason } = req.body; // action: 'accept' | 'reject'

    if (req.role !== 'admin') {
      return res.status(403).json({ error: 'Only Master Admin can review cost adjustments.' });
    }

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (!order.cost_adjustment_amount || order.cost_adjustment_status !== 'requested') {
      return res.status(400).json({ error: 'No active cost adjustment request found for this order.' });
    }

    const adjAmount = Number(order.cost_adjustment_amount) || 0;
    const history = Array.isArray(order.status_history) ? order.status_history : [];

    if (action === 'accept') {
      const newMfgEarnings = Number(order.mfg_earnings || 0) + adjAmount;
      const historyEntry = {
        type: 'cost_adjustment_approved',
        amount: adjAmount,
        time: new Date().toISOString()
      };

      const payload = {
        cost_adjustment_status: 'approved',
        mfg_earnings: newMfgEarnings,
        status_history: [...history, historyEntry],
        updated_at: new Date().toISOString()
      };

      const { data: updatedOrder, error: updateErr } = await supabaseAdmin
        .from('orders')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Credit Manufacturer Wallet immediately with approved amount
      if (order.mfg_id && adjAmount > 0) {
        await updateWallet('mfg', order.mfg_id, adjAmount);
      }
      // Update Master Admin Ledger/Wallet as well
      await updateWallet('admin', req.uid || 'admin', adjAmount);

      // Close open cost adjustment ticket if present
      try {
        const orderRef = order.order_id || order.id;
        const { data: tickets } = await supabaseAdmin
          .from('tickets')
          .select('id')
          .eq('order_id', orderRef)
          .eq('category', 'Cost Adjustment Request')
          .eq('status', 'open');
        
        if (tickets && tickets.length > 0) {
          for (const t of tickets) {
            await supabaseAdmin.from('tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', t.id);
            await supabaseAdmin.from('ticket_messages').insert({
              ticket_id: t.id,
              sender_id: req.uid,
              sender_role: 'admin',
              text: `Cost adjustment request of ₹${adjAmount} has been APPROVED by Master Admin.`
            });
          }
        }
      } catch (tErr) {
        console.error('Error closing cost adjustment ticket:', tErr.message);
      }

      return res.json({ success: true, message: `Cost adjustment of ₹${adjAmount} accepted! Manufacturer and Master wallets updated.`, order: updatedOrder });
    } else if (action === 'reject') {
      const historyEntry = {
        type: 'cost_adjustment_rejected',
        amount: adjAmount,
        reason: reject_reason || 'Rejected by Master Admin',
        time: new Date().toISOString()
      };

      const payload = {
        cost_adjustment_status: 'rejected',
        status_history: [...history, historyEntry],
        updated_at: new Date().toISOString()
      };

      const { data: updatedOrder, error: updateErr } = await supabaseAdmin
        .from('orders')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      // Close open cost adjustment ticket if present
      try {
        const orderRef = order.order_id || order.id;
        const { data: tickets } = await supabaseAdmin
          .from('tickets')
          .select('id')
          .eq('order_id', orderRef)
          .eq('category', 'Cost Adjustment Request')
          .eq('status', 'open');
        
        if (tickets && tickets.length > 0) {
          for (const t of tickets) {
            await supabaseAdmin.from('tickets').update({ status: 'closed', updated_at: new Date().toISOString() }).eq('id', t.id);
            await supabaseAdmin.from('ticket_messages').insert({
              ticket_id: t.id,
              sender_id: req.uid,
              sender_role: 'admin',
              text: `Cost adjustment request of ₹${adjAmount} has been REJECTED by Master Admin. Reason: ${reject_reason || 'Rejected by Master Admin'}`
            });
          }
        }
      } catch (tErr) {
        console.error('Error closing cost adjustment ticket:', tErr.message);
      }

      return res.json({ success: true, message: 'Cost adjustment request rejected. Manufacturer can re-request if needed.', order: updatedOrder });
    } else {
      return res.status(400).json({ error: 'Invalid action. Expected "accept" or "reject".' });
    }
  } catch (err) {
    console.error('Error reviewing cost adjustment:', err.message);
    res.status(500).json({ error: 'Failed to review cost adjustment.' });
  }
});

// POST /api/orders/:id/customer-cancel - Customer cancels order within 36 hours
router.post('/:id/customer-cancel', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'Order is already cancelled.' });
    }
    if (order.status === 'completed' || order.status === 'delivered') {
      return res.status(400).json({ error: 'Delivered orders cannot be cancelled.' });
    }

    // Check 36-hour window
    const createdAt = new Date(order.created_at).getTime();
    const now = Date.now();
    const hoursElapsed = (now - createdAt) / (1000 * 60 * 60);

    if (hoursElapsed > 36) {
      return res.status(400).json({ error: 'Cancellation window (36 hours) has expired for this order.' });
    }

    const history = Array.isArray(order.status_history) ? order.status_history : [];
    const historyEntry = {
      status: 'cancelled',
      cancelled_by: 'customer',
      reason: reason || 'Customer requested cancellation within 36 hours',
      time: new Date().toISOString()
    };

    const payload = {
      status: 'cancelled',
      status_history: [...history, historyEntry],
      updated_at: new Date().toISOString()
    };

    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Send confirmation email to customer
    try {
      let recipientEmail = order.contact || order.customer_email;
      if (!recipientEmail && order.user_id) {
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('email')
          .eq('id', order.user_id)
          .single();
        if (userData && userData.email) recipientEmail = userData.email;
      }
      if (recipientEmail) {
        const orderNum = updatedOrder.order_id || updatedOrder.id?.slice(0, 10).toUpperCase();
        await sendOrderCancellationEmail(recipientEmail, orderNum, 'Cancelled by customer within 36 hours');
      }
    } catch (mailErr) {
      console.error('Failed to send customer cancellation email:', mailErr);
    }

    res.json({ success: true, message: 'Order cancelled successfully. Refund will be processed within 48 hours.', order: updatedOrder });
  } catch (err) {
    console.error('Error handling customer cancellation:', err.message);
    res.status(500).json({ error: 'Failed to cancel order.' });
  }
});

// POST /api/orders/:id/approve-cancellation - Master Admin approves manufacturer cancellation report
router.post('/:id/approve-cancellation', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (req.role !== 'admin') {
      return res.status(403).json({ error: 'Only Master Admin can approve cancellation requests.' });
    }

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const history = Array.isArray(order.status_history) ? order.status_history : [];
    const historyEntry = {
      status: 'cancelled',
      approved_by: 'master',
      reason: reason || 'Master approved manufacturer cancellation request',
      time: new Date().toISOString()
    };

    const payload = {
      status: 'cancelled',
      status_history: [...history, historyEntry],
      updated_at: new Date().toISOString()
    };

    const { data: updatedOrder, error: updateErr } = await supabaseAdmin
      .from('orders')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Send Cancellation Email to Customer
    try {
      let recipientEmail = order.contact || order.customer_email;
      if (!recipientEmail && order.user_id) {
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('email')
          .eq('id', order.user_id)
          .single();
        if (userData && userData.email) recipientEmail = userData.email;
      }
      if (recipientEmail) {
        const orderNum = updatedOrder.order_id || updatedOrder.id?.slice(0, 10).toUpperCase();
        await sendOrderCancellationEmail(recipientEmail, orderNum, reason || 'Manufacturing constraint');
      }
    } catch (mailErr) {
      console.error('Failed to send cancellation email:', mailErr);
    }

    res.json({ success: true, message: 'Cancellation approved. Customer notified and refund initiated within 48 hours.', order: updatedOrder });
  } catch (err) {
    console.error('Error approving cancellation:', err.message);
    res.status(500).json({ error: 'Failed to approve cancellation.' });
  }
});

export default router;
