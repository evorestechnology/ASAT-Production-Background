import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, resolveAnyRole } from '../middleware/auth.js';
import { sendOrderCancellationEmail } from '../utils/mailer.js';
import { syncWalletBalance } from './wallets.js';
import { getStoredPromos, saveStoredPromos } from './promos.js';

const router = express.Router();

function decorateOrderWithCostAdjustment(order) {
  if (!order) return order;
  const history = Array.isArray(order.status_history) ? order.status_history : [];
  
  // Hoist tax and shipping from pricing snapshot if not directly on the record
  const pricing = history[0]?.pricing || {};
  if (order.shipping_amount === undefined || order.shipping_amount === null) {
    if (pricing.shipping_amount !== undefined) {
      order.shipping_amount = Number(pricing.shipping_amount) || 0;
    }
  }
  if (order.tax_amount === undefined || order.tax_amount === null) {
    if (pricing.tax_amount !== undefined) {
      order.tax_amount = Number(pricing.tax_amount) || 0;
    }
  }
  
  let latestRequest = null;
  let latestApproval = null;
  let latestRejection = null;
  
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.type === 'cost_adjustment_request' && !latestRequest) {
      latestRequest = entry;
    }
    if (entry.type === 'cost_adjustment_approved' && !latestApproval) {
      latestApproval = entry;
    }
    if (entry.type === 'cost_adjustment_rejected' && !latestRejection) {
      latestRejection = entry;
    }
  }
  
  const getEntryTime = (e) => e && e.time ? new Date(e.time).getTime() : 0;
  
  const reqTime = getEntryTime(latestRequest);
  const appTime = getEntryTime(latestApproval);
  const rejTime = getEntryTime(latestRejection);
  
  const maxTime = Math.max(reqTime, appTime, rejTime);
  if (maxTime === 0) {
    order.cost_adjustment_status = null;
    order.cost_adjustment_amount = null;
    order.cost_adjustment_reason = null;
    return order;
  }
  
  if (maxTime === reqTime) {
    order.cost_adjustment_status = 'requested';
    order.cost_adjustment_amount = latestRequest.amount;
    order.cost_adjustment_reason = latestRequest.reason;
  } else if (maxTime === appTime) {
    order.cost_adjustment_status = 'approved';
    order.cost_adjustment_amount = latestApproval.amount;
    order.cost_adjustment_reason = '';
  } else {
    order.cost_adjustment_status = 'rejected';
    order.cost_adjustment_amount = latestRejection.amount;
    order.cost_adjustment_reason = latestRejection.reason;
  }
  
  return order;
}

function decorateOrders(orders) {
  if (!orders) return orders;
  if (Array.isArray(orders)) {
    return orders.map(decorateOrderWithCostAdjustment);
  }
  return decorateOrderWithCostAdjustment(orders);
}

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
    res.json(decorateOrders(data) || []);
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
    res.json(decorateOrders(data) || []);
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
    res.json(decorateOrders(data));
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
          item.user_price = itemPrice;
          item.mfg_price = itemPrice;
          item.designer_price = 0;
          item.master_price = 0;
          item.price = itemPrice;
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

              const itemMfgPrice = baseCost + actualPrintingCost;
              computedMfgEarnings += itemMfgPrice * qty;
              computedDesignerEarnings += designerCost * qty;

              // Snapshot prices on item object
              item.price = itemPrice;
              item.user_price = itemPrice;
              item.mfg_price = itemMfgPrice;
              item.designer_price = designerCost;
              item.master_price = Math.max(0, itemPrice - (itemMfgPrice + designerCost));
              item.baseCost = baseCost;
              item.printCost = actualPrintingCost;
            } else {
              const dEarn = Math.round(itemPrice * 0.1);
              const mEarn = Math.round(itemPrice * 0.4);
              computedDesignerEarnings += dEarn * qty;
              computedMfgEarnings += mEarn * qty;

              item.price = itemPrice;
              item.user_price = itemPrice;
              item.mfg_price = mEarn;
              item.designer_price = dEarn;
              item.master_price = Math.max(0, itemPrice - (mEarn + dEarn));
            }
          } catch (err) {
            console.error("Error calculating item earnings on backend:", err);
            const dEarn = Math.round(itemPrice * 0.1);
            const mEarn = Math.round(itemPrice * 0.4);
            computedDesignerEarnings += dEarn * qty;
            computedMfgEarnings += mEarn * qty;

            item.price = itemPrice;
            item.user_price = itemPrice;
            item.mfg_price = mEarn;
            item.designer_price = dEarn;
            item.master_price = Math.max(0, itemPrice - (mEarn + dEarn));
          }
        }
      }
    }

    const finalTotal = Math.max(Number(total_amount) || 0, computedMfgEarnings + computedDesignerEarnings);
    const computedPlatformEarnings = Math.max(0, finalTotal - computedMfgEarnings - computedDesignerEarnings);

    const initialStatus = req.body.status || (req.body.payment_status === 'PAID' ? 'confirmed' : 'pending');

    const isValidUUID = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
    const safeUserId = isValidUUID(user_id) ? user_id : null;
    const safeDesignerId = isValidUUID(designer_id) ? designer_id : null;
    const safeMfgId = isValidUUID(mfg_id) ? mfg_id : null;

    const payload = {
      order_id,
      user_id: safeUserId,
      customer_name,
      items,
      total_amount: finalTotal,
      designer_earnings: computedDesignerEarnings,
      mfg_earnings: computedMfgEarnings,
      platform_earnings: computedPlatformEarnings,
      designer_id: safeDesignerId,
      designer_username: designer_username || 'anonymous',
      mfg_id: safeMfgId,
      status: initialStatus,
      contact: contact || '',
      phone: phone || '',
      address: address || '',
      country: country || 'India',
      tracking_id: '',
      status_history: [{
        status: initialStatus,
        time: new Date().toISOString(),
          pricing: {
            subtotal: items && Array.isArray(items) ? items.reduce((s, i) => s + ((Number(i.price) || 0) * (Number(i.qty) || 1)), 0) : 0,
            discount_amount: Number(req.body.discount_amount) || 0,
            promo_code: req.body.promo_code || null,
            shipping_amount: Number(req.body.shipping_amount) || 0,
            tax_amount: Number(req.body.tax_amount) || 0,
            total_amount: finalTotal
          }
      }],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Check if order already exists with this order_id (idempotent creation)
    const { data: existingOrder } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('order_id', order_id)
      .maybeSingle();

    let data, error;
    if (existingOrder) {
      const updateRes = await supabaseAdmin
        .from('orders')
        .update({
          ...payload,
          created_at: existingOrder.created_at,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingOrder.id)
        .select()
        .single();
      data = updateRes.data;
      error = updateRes.error;
    } else {
      const insertRes = await supabaseAdmin
        .from('orders')
        .insert(payload)
        .select()
        .single();
      data = insertRes.data;
      error = insertRes.error;
    }

    if (error) throw error;

    // Record promo code usage if applicable
    if (req.body.promo_code && safeUserId) {
      try {
        const promos = await getStoredPromos();
        let updated = false;
        const pcode = req.body.promo_code.trim().toUpperCase();
        for (let p of promos) {
          if (p.code.toUpperCase() === pcode) {
            if (!p.usedBy) p.usedBy = [];
            if (!p.usedBy.includes(safeUserId)) {
              p.usedBy.push(safeUserId);
              updated = true;
            }
            break;
          }
        }
        if (updated) {
          await saveStoredPromos(promos);
        }
      } catch (e) {
        console.error('Failed to record promo usage:', e);
      }
    }

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

    const isUUID = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const column = isUUID ? 'id' : 'order_id';

    const { data: order, error: fetchError } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq(column, id)
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
    if (finalStatus === 'in_progress') {
      finalStatus = 'manufacturing';
    }
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
      } else if (finalStatus === 'shipping') {
        payload.shipped_at = new Date().toISOString();
      }
    }

    const { data: updatedOrder, error } = await supabaseAdmin
      .from('orders')
      .update(payload)
      .eq('id', order.id)
      .select()
      .single();

    if (error) throw error;

    // Immediately credit and sync designer and manufacturer wallet balances upon delivery
    if (finalStatus === 'completed' || finalStatus === 'delivered') {
      const dId = updatedOrder?.designer_id || order?.designer_id;
      if (dId) {
        try {
          await syncWalletBalance(dId);
        } catch (wErr) {
          console.error('Error syncing designer wallet upon order delivery:', wErr.message);
        }
      }

      const mId = updatedOrder?.mfg_id || order?.mfg_id;
      if (mId) {
        try {
          await syncWalletBalance(mId);
        } catch (wErr) {
          console.error('Error syncing mfg wallet upon order delivery:', wErr.message);
        }
      }

      // Check other item-level designers if present
      const orderItems = Array.isArray(order?.items) ? order.items : [];
      const checkedDesigners = new Set([dId]);
      for (const item of orderItems) {
        const itemDId = item.designer_id || item.designerId;
        if (itemDId && !checkedDesigners.has(itemDId)) {
          checkedDesigners.add(itemDId);
          try {
            await syncWalletBalance(itemDId);
          } catch (wErr) {
            console.error('Error syncing item designer wallet upon delivery:', wErr.message);
          }
        }
      }
    }

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

        // Also update total_earnings in designers table
        const { data: designerData } = await supabaseAdmin
          .from('designers')
          .select('total_earnings')
          .eq('id', updatedOrder.designer_id)
          .maybeSingle();
        if (designerData) {
          await supabaseAdmin
            .from('designers')
            .update({
              total_earnings: Number(designerData.total_earnings || 0) + Number(updatedOrder.designer_earnings || 0)
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

        // Also deduct total_earnings in designers table
        const { data: designerData } = await supabaseAdmin
          .from('designers')
          .select('total_earnings')
          .eq('id', updatedOrder.designer_id)
          .maybeSingle();
        if (designerData) {
          await supabaseAdmin
            .from('designers')
            .update({
              total_earnings: Math.max(0, Number(designerData.total_earnings || 0) - Number(updatedOrder.designer_earnings || 0))
            })
            .eq('id', updatedOrder.designer_id);
        }
      }
    }

    res.json({ success: true, order: decorateOrders(updatedOrder) });
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

    res.json({ success: true, order: decorateOrders(updatedOrder) });
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

    const decoratedOrder = decorateOrderWithCostAdjustment(order);
    if (!decoratedOrder.cost_adjustment_amount || decoratedOrder.cost_adjustment_status !== 'requested') {
      return res.status(400).json({ error: 'No active cost adjustment request found for this order.' });
    }

    const adjAmount = Number(decoratedOrder.cost_adjustment_amount) || 0;
    const history = Array.isArray(order.status_history) ? order.status_history : [];

    if (action === 'accept') {
      const newMfgEarnings = Number(order.mfg_earnings || 0) + adjAmount;
      const historyEntry = {
        type: 'cost_adjustment_approved',
        amount: adjAmount,
        time: new Date().toISOString()
      };

      const newPlatformEarnings = Math.max(0, Number(order.total_amount || 0) - newMfgEarnings - Number(order.designer_earnings || 0));

      const payload = {
        mfg_earnings: newMfgEarnings,
        platform_earnings: newPlatformEarnings,
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

      // Resync Manufacturer Wallet immediately
      if (order.mfg_id) {
        await syncWalletBalance(order.mfg_id);
      }

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

      return res.json({ success: true, message: `Cost adjustment of ₹${adjAmount} accepted! Manufacturer and Master wallets updated.`, order: decorateOrders(updatedOrder) });
    } else if (action === 'reject') {
      const historyEntry = {
        type: 'cost_adjustment_rejected',
        amount: adjAmount,
        reason: reject_reason || 'Rejected by Master Admin',
        time: new Date().toISOString()
      };

      const payload = {
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

      return res.json({ success: true, message: 'Cost adjustment request rejected. Manufacturer can re-request if needed.', order: decorateOrders(updatedOrder) });
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

    const isUUID = typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const column = isUUID ? 'id' : 'order_id';

    const { data: order, error: fetchErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq(column, id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (req.role !== 'admin' && order.user_id && order.user_id !== req.uid) {
      return res.status(403).json({ error: 'You can only cancel your own orders.' });
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
      .eq('id', order.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    // Resync wallets so pending or eligible earnings are cleared
    if (order.designer_id) {
      try { await syncWalletBalance(order.designer_id); } catch (_) {}
    }
    if (order.mfg_id) {
      try { await syncWalletBalance(order.mfg_id); } catch (_) {}
    }

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
