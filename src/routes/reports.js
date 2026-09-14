import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// All routes are admin-only
// Helper: parse date range from query
function getDateRange(from, to) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const end = to ? new Date(to) : now;
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

// 1. GET /api/reports/revenue-summary
router.get('/revenue-summary', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);
    
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('total_amount, status, created_at, status_history')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    let grossRevenue = 0;
    let taxCollected = 0;
    let shippingRevenue = 0;
    let discountGiven = 0;
    let cancelledRevenue = 0;
    let totalOrders = (orders || []).length;
    let completedOrders = 0;

    const dailyBreakdownMap = {};

    (orders || []).forEach(order => {
      const date = order.created_at ? order.created_at.split('T')[0] : 'Unknown';
      if (!dailyBreakdownMap[date]) {
        dailyBreakdownMap[date] = { date, revenue: 0, orders: 0 };
      }
      dailyBreakdownMap[date].orders += 1;

      const pricing = order.status_history?.[0]?.pricing || {};
      const tax = Number(pricing.tax_amount) || 0;
      const shipping = Number(pricing.shipping_amount) || 0;
      const discount = Number(pricing.discount_amount) || 0;

      if (order.status === 'cancelled') {
        cancelledRevenue += Number(order.total_amount) || 0;
      } else {
        grossRevenue += Number(order.total_amount) || 0;
        taxCollected += tax;
        shippingRevenue += shipping;
        discountGiven += discount;
        dailyBreakdownMap[date].revenue += Number(order.total_amount) || 0;
      }

      if (order.status === 'completed' || order.status === 'delivered') {
        completedOrders += 1;
      }
    });

    const netRevenue = grossRevenue - discountGiven;
    const dailyBreakdown = Object.values(dailyBreakdownMap).sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      totals: { grossRevenue, taxCollected, shippingRevenue, discountGiven, netRevenue, totalOrders, completedOrders },
      dailyBreakdown,
      dateRange: { from: start, to: end }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET /api/reports/orders-by-status
router.get('/orders-by-status', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);
    
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('status, created_at, total_amount')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    const byStatus = { pending: 0, confirmed: 0, processing: 0, shipped: 0, delivered: 0, completed: 0, cancelled: 0 };
    let nonCancelledTotal = 0;
    let nonCancelledCount = 0;

    orders.forEach(order => {
      const s = order.status?.toLowerCase();
      if (byStatus[s] !== undefined) {
        byStatus[s] += 1;
      } else {
        byStatus[s] = 1;
      }

      if (s !== 'cancelled') {
        nonCancelledTotal += Number(order.total_amount) || 0;
        nonCancelledCount += 1;
      }
    });

    const avgOrderValue = nonCancelledCount > 0 ? nonCancelledTotal / nonCancelledCount : 0;

    res.json({
      byStatus,
      totalOrders: orders.length,
      avgOrderValue,
      dateRange: { from: start, to: end }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. GET /api/reports/top-designers
router.get('/top-designers', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);
    const limit = parseInt(req.query.limit, 10) || 20;

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('designer_id, designer_username, designer_earnings')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    const grouped = {};
    orders.forEach(o => {
      if (!o.designer_id) return;
      if (!grouped[o.designer_id]) {
        grouped[o.designer_id] = { designer_id: o.designer_id, username: o.designer_username, orderCount: 0, totalEarnings: 0 };
      }
      grouped[o.designer_id].orderCount += 1;
      grouped[o.designer_id].totalEarnings += Number(o.designer_earnings) || 0;
    });

    let designers = Object.values(grouped).sort((a, b) => b.totalEarnings - a.totalEarnings).slice(0, limit);

    if (designers.length > 0) {
      const ids = designers.map(d => d.designer_id);
      const { data: designerData } = await supabaseAdmin.from('designers').select('id, full_name').in('id', ids);
      if (designerData) {
        designers = designers.map(d => {
          const info = designerData.find(x => x.id === d.designer_id);
          return { ...d, name: info ? info.full_name : null };
        });
      }
    }

    res.json({ designers, dateRange: { from: start, to: end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/reports/top-products
router.get('/top-products', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);
    
    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('items')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    const grouped = {};
    orders.forEach(order => {
      let items = order.items || [];
      if (typeof items === 'string') {
         try { items = JSON.parse(items); } catch(e) { items = []; }
      }
      items.forEach(item => {
        const id = item.design_id || item.id;
        if (!id) return;
        if (!grouped[id]) {
          grouped[id] = { id, name: item.name || item.title || 'Unknown', designerUsername: item.designer_username || item.designer || null, orderCount: 0, totalRevenue: 0, totalQty: 0 };
        }
        grouped[id].orderCount += 1;
        grouped[id].totalQty += Number(item.quantity) || 1;
        grouped[id].totalRevenue += (Number(item.price) || 0) * (Number(item.quantity) || 1);
      });
    });

    const products = Object.values(grouped).sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 50);

    res.json({ products, dateRange: { from: start, to: end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. GET /api/reports/mfg-performance
router.get('/mfg-performance', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('mfg_id, mfg_earnings, status')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    const grouped = {};
    orders.forEach(o => {
      if (!o.mfg_id) return;
      if (!grouped[o.mfg_id]) {
        grouped[o.mfg_id] = { mfg_id: o.mfg_id, orderCount: 0, totalEarnings: 0, completedCount: 0 };
      }
      grouped[o.mfg_id].orderCount += 1;
      grouped[o.mfg_id].totalEarnings += Number(o.mfg_earnings) || 0;
      if (['completed', 'delivered'].includes(o.status?.toLowerCase())) {
        grouped[o.mfg_id].completedCount += 1;
      }
    });

    let manufacturers = Object.values(grouped);

    if (manufacturers.length > 0) {
      const ids = manufacturers.map(m => m.mfg_id);
      const { data: mfgData } = await supabaseAdmin.from('manufacturers').select('id, full_name, company_name').in('id', ids);
      if (mfgData) {
        manufacturers = manufacturers.map(m => {
          const info = mfgData.find(x => x.id === m.mfg_id);
          return { ...m, name: info ? (info.company_name || info.full_name) : null };
        });
      }
    }

    res.json({ manufacturers, dateRange: { from: start, to: end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET /api/reports/customer-activity
router.get('/customer-activity', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('user_id, total_amount, created_at, status, country')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    const grouped = {};
    orders.forEach(o => {
      if (!o.user_id) return;
      if (!grouped[o.user_id]) {
        grouped[o.user_id] = { user_id: o.user_id, orderCount: 0, totalSpend: 0, lastOrderDate: o.created_at, country: o.country || 'India' };
      }
      grouped[o.user_id].orderCount += 1;
      if (o.country) grouped[o.user_id].country = o.country;
      if (o.status !== 'cancelled') {
        grouped[o.user_id].totalSpend += Number(o.total_amount) || 0;
      }
      if (new Date(o.created_at) > new Date(grouped[o.user_id].lastOrderDate)) {
        grouped[o.user_id].lastOrderDate = o.created_at;
      }
    });

    let customers = Object.values(grouped);
    
    // newCustomers = users who placed their first ever order in this date range
    let newCustomers = 0;
    
    if (customers.length > 0) {
      const ids = customers.map(c => c.user_id);
      
      const { data: userFirstOrders } = await supabaseAdmin
        .from('orders')
        .select('user_id, created_at')
        .in('user_id', ids)
        .order('created_at', { ascending: true });
        
      const firstOrdersMap = {};
      if (userFirstOrders) {
        userFirstOrders.forEach(o => {
          if (!firstOrdersMap[o.user_id]) firstOrdersMap[o.user_id] = o.created_at;
        });
      }

      customers.forEach(c => {
         const firstOrderTime = new Date(firstOrdersMap[c.user_id]);
         if (firstOrderTime >= new Date(start) && firstOrderTime <= new Date(end)) {
            newCustomers += 1;
         }
      });

      const { data: userData } = await supabaseAdmin.from('users').select('id, full_name, email').in('id', ids);
      if (userData) {
        customers = customers.map(c => {
          const info = userData.find(x => x.id === c.user_id);
          return { ...c, name: info?.full_name, email: info?.email };
        });
      }
    }

    let repeatBuyers = 0;
    let sumSpend = 0;
    let nonCancelledCount = 0;
    customers.forEach(c => {
       if (c.orderCount > 1) repeatBuyers += 1;
       sumSpend += c.totalSpend;
       if (c.totalSpend > 0) nonCancelledCount += c.orderCount; // Rough approx
    });

    res.json({
      customers,
      summary: {
        totalCustomers: customers.length,
        newCustomers,
        repeatBuyers,
        avgOrderValue: sumSpend > 0 && orders.length > 0 ? sumSpend / orders.filter(o => o.status !== 'cancelled').length : 0
      },
      dateRange: { from: start, to: end }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. GET /api/reports/promo-usage
router.get('/promo-usage', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);

    const { data: orders, error } = await supabaseAdmin
      .from('orders')
      .select('status_history')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    const grouped = {};
    let totalOrdersWithPromo = 0;
    let totalDiscountGiven = 0;

    orders.forEach(o => {
      const pricing = o.status_history?.[0]?.pricing;
      if (pricing?.promo_code) {
        const code = pricing.promo_code;
        const discount = Number(pricing.discount_amount) || 0;
        
        if (!grouped[code]) {
          grouped[code] = { code, uses: 0, totalDiscount: 0 };
        }
        grouped[code].uses += 1;
        grouped[code].totalDiscount += discount;
        
        totalOrdersWithPromo += 1;
        totalDiscountGiven += discount;
      }
    });

    let promoCodes = Object.values(grouped);

    const { data: settingsData } = await supabaseAdmin.from('settings').select('value').eq('key', 'promo_codes').maybeSingle();
    if (settingsData && settingsData.value && Array.isArray(settingsData.value)) {
      promoCodes = promoCodes.map(pc => {
         const info = settingsData.value.find(x => x.code === pc.code);
         return {
           ...pc,
           discountType: info?.discount_type || null,
           discountValue: info?.discount_value || null,
           isActive: info?.is_active ?? null
         };
      });
    }

    res.json({ promoCodes, summary: { totalOrdersWithPromo, totalDiscountGiven }, dateRange: { from: start, to: end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. GET /api/reports/support-tickets
router.get('/support-tickets', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);

    const { data: ticketsData, error } = await supabaseAdmin
      .from('tickets')
      .select('id, created_at, subject, status, user_id')
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;

    let open = 0, closed = 0, resolved = 0;
    
    ticketsData.forEach(t => {
      const s = t.status?.toLowerCase() || 'open';
      if (s === 'open' || s === 'in_progress') open += 1;
      else if (s === 'closed') closed += 1;
      else if (s === 'resolved') resolved += 1;
    });

    let tickets = ticketsData;

    if (tickets.length > 0) {
      const ids = [...new Set(tickets.map(t => t.user_id).filter(Boolean))];
      if (ids.length > 0) {
        const { data: userData } = await supabaseAdmin.from('users').select('id, full_name').in('id', ids);
        if (userData) {
           tickets = tickets.map(t => {
             const info = userData.find(x => x.id === t.user_id);
             return { ...t, userName: info?.full_name || null };
           });
        }
      }
    }
    
    tickets = tickets.map(t => ({
       id: t.id,
       subject: t.subject,
       status: t.status,
       userName: t.userName,
       createdAt: t.created_at,
       updatedAt: t.created_at
    }));

    res.json({
      tickets,
      summary: { total: tickets.length, open, closed, resolved },
      dateRange: { from: start, to: end }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. GET /api/reports/inventory-alerts
router.get('/inventory-alerts', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data: designs, error: designsError } = await supabaseAdmin.from('designs').select('id, title, status, created_at, designer_id, orders_count');
    if (designsError) throw designsError;

    const { data: products, error: productsError } = await supabaseAdmin.from('products').select('id, name, status');
    if (productsError) throw productsError;

    let approved = 0, pending = 0, rejected = 0;
    const slowMovers = [];
    const pendingApproval = [];

    designs.forEach(d => {
       const s = d.status?.toLowerCase();
       if (s === 'approved') approved += 1;
       else if (s === 'pending') { pending += 1; pendingApproval.push(d); }
       else if (s === 'rejected') rejected += 1;
       
       if (s === 'approved' && (d.orders_count || 0) < 3) {
         slowMovers.push(d);
       }
    });

    res.json({
      summary: {
        totalDesigns: designs.length,
        approved,
        pending,
        rejected,
        slowMovers: slowMovers.length
      },
      slowMoverDesigns: slowMovers,
      pendingApproval
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. GET /api/reports/designer-payouts
router.get('/designer-payouts', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query.from, req.query.to);
    
    const { data: designersData, error: dError } = await supabaseAdmin.from('designers').select('id, full_name, username');
    if (dError) throw dError;

    const { data: walletsData, error: wError } = await supabaseAdmin.from('wallets').select('user_id, balance');
    if (wError) throw wError;
    
    const { data: orders, error: oError } = await supabaseAdmin
      .from('orders')
      .select('designer_id, designer_earnings')
      .gte('created_at', start)
      .lte('created_at', end);
    if (oError) throw oError;
    
    const earningsMap = {};
    orders.forEach(o => {
      if (!o.designer_id) return;
      if (!earningsMap[o.designer_id]) earningsMap[o.designer_id] = 0;
      earningsMap[o.designer_id] += Number(o.designer_earnings) || 0;
    });

    const designers = designersData.map(d => {
      const w = walletsData.find(x => x.user_id === d.id);
      return {
        id: d.id,
        name: d.full_name,
        username: d.username,
        walletBalance: w ? Number(w.balance) || 0 : 0,
        totalEarned: earningsMap[d.id] || 0
      };
    });

    res.json({ designers, dateRange: { from: start, to: end } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
