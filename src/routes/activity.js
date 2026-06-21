import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/activity - Fetch chronological admin activity log (admin only)
router.get('/', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const results = [];

    // 1. Products (manufacturer activity)
    const { data: productsData } = await supabaseAdmin
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (productsData) {
      productsData.forEach(data => {
        results.push({
          id: `prod_c_${data.id}`,
          type: 'product_added',
          role: 'mfg',
          title: `${data.mfg_name || 'A manufacturer'} added a product`,
          subtitle: data.title || 'Unnamed product',
          user: data.mfg_name || data.mfg_id || '—',
          ts: data.created_at,
        });
        if (data.updated_at && data.created_at) {
          const created = new Date(data.created_at).getTime();
          const updated = new Date(data.updated_at).getTime();
          if (updated - created > 60000) {
            results.push({
              id: `prod_u_${data.id}`,
              type: 'product_updated',
              role: 'mfg',
              title: `${data.mfg_name || 'A manufacturer'} updated a product`,
              subtitle: data.title || 'Unnamed product',
              user: data.mfg_name || data.mfg_id || '—',
              ts: data.updated_at,
            });
          }
        }
      });
    }

    // 2. Designs (designer activity)
    const { data: designsData } = await supabaseAdmin
      .from('designs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (designsData) {
      designsData.forEach(data => {
        results.push({
          id: `des_${data.id}`,
          type: 'design_uploaded',
          role: 'designer',
          title: `${data.designer_username || 'A designer'} uploaded a design`,
          subtitle: data.title || 'Untitled design',
          user: data.designer_username || '—',
          ts: data.created_at,
        });
        if (data.status === 'approved' && data.updated_at) {
          results.push({
            id: `des_a_${data.id}`,
            type: 'design_approved',
            role: 'designer',
            title: `Design approved`,
            subtitle: data.title || 'Untitled design',
            user: data.designer_username || '—',
            ts: data.updated_at,
          });
        } else if (data.status === 'rejected' && data.updated_at) {
          results.push({
            id: `des_r_${data.id}`,
            type: 'design_rejected',
            role: 'designer',
            title: `Design rejected`,
            subtitle: data.title || 'Untitled design',
            user: data.designer_username || '—',
            ts: data.updated_at,
          });
        }
      });
    }

    // 3. Orders
    const { data: ordersData } = await supabaseAdmin
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(30);

    if (ordersData) {
      ordersData.forEach(data => {
        results.push({
          id: `ord_${data.id}`,
          type: 'order_placed',
          role: 'mfg',
          title: `New order placed`,
          subtitle: `Order #${data.order_id.substring(0, 8)} — ₹${Number(data.total_amount || 0).toLocaleString()}`,
          user: data.mfg_id || 'Manufacturer',
          ts: data.created_at,
        });
      });
    }

    // 4. Print style updates (manufacturer)
    const { data: psData } = await supabaseAdmin
      .from('print_styles')
      .select('*')
      .order('updated_at', { ascending: false });

    if (psData) {
      psData.forEach(data => {
        results.push({
          id: `ps_${data.id}`,
          type: 'print_styles',
          role: 'mfg',
          title: `Manufacturer updated print styles`,
          subtitle: `${data.name} configured`,
          user: data.mfg_id,
          ts: data.updated_at,
        });
      });
    }

    // 5. New designer registrations
    const { data: designersData } = await supabaseAdmin
      .from('designers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (designersData) {
      designersData.forEach(data => {
        results.push({
          id: `djoin_${data.id}`,
          type: 'designer_joined',
          role: 'designer',
          title: `New designer registered`,
          subtitle: data.full_name || data.username || 'Unknown designer',
          user: data.username || data.id,
          ts: data.created_at,
        });
      });
    }

    // 6. New manufacturer registrations
    const { data: manufacturersData } = await supabaseAdmin
      .from('manufacturers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (manufacturersData) {
      manufacturersData.forEach(data => {
        results.push({
          id: `mjoin_${data.id}`,
          type: 'mfg_joined',
          role: 'mfg',
          title: `New manufacturer onboarded`,
          subtitle: data.business_name || 'Unknown manufacturer',
          user: data.business_name || data.id,
          ts: data.created_at,
        });
      });
    }

    // Sort chronologically descending
    results.sort((a, b) => {
      const timeA = a.ts ? new Date(a.ts).getTime() : 0;
      const timeB = b.ts ? new Date(b.ts).getTime() : 0;
      return timeB - timeA;
    });

    res.json(results);
  } catch (err) {
    console.error('Error compiling activity feed:', err.message);
    res.status(500).json({ error: 'Failed to fetch activity log' });
  }
});

export default router;
