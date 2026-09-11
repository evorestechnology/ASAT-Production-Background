import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin, verifyDesigner, verifyMfg } from '../middleware/auth.js';
import { syncWalletBalance } from './wallets.js';

const router = express.Router();

// GET /api/dashboard/admin - Admin dashboard data (admin only)
router.get('/admin', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const [ordersRes, designersRes, designsRes, ticketsRes] = await Promise.all([
      supabaseAdmin.from('orders').select('*'),
      supabaseAdmin.from('designers').select('*'),
      supabaseAdmin.from('designs').select('*'),
      supabaseAdmin.from('tickets').select('*')
    ]);

    if (ordersRes.error) throw ordersRes.error;
    if (designersRes.error) throw designersRes.error;
    if (designsRes.error) throw designsRes.error;
    if (ticketsRes.error) throw ticketsRes.error;

    res.json({
      orders: ordersRes.data || [],
      designers: designersRes.data || [],
      designs: designsRes.data || [],
      tickets: ticketsRes.data || []
    });
  } catch (err) {
    console.error('Error fetching admin dashboard stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

// GET /api/dashboard/designer - Designer dashboard data (designer only)
router.get('/designer', verifyAuth, verifyDesigner, async (req, res) => {
  try {
    const syncedWallet = await syncWalletBalance(req.uid).catch(() => null);

    const [designsRes, ordersRes] = await Promise.all([
      supabaseAdmin.from('designs').select('*').eq('designer_id', req.uid),
      supabaseAdmin.from('orders').select('*').eq('designer_id', req.uid)
    ]);

    if (designsRes.error) throw designsRes.error;
    if (ordersRes.error) throw ordersRes.error;

    res.json({
      designs: designsRes.data || [],
      orders: ordersRes.data || [],
      profile: {
        points: req.designerData.points || 0,
        total_earnings: req.designerData.total_earnings || 0,
        wallet: syncedWallet || { balance: 0, total_earnings: 0, pending_balance: 0 }
      }
    });
  } catch (err) {
    console.error('Error fetching designer dashboard stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch designer stats' });
  }
});

// GET /api/dashboard/mfg - Manufacturer dashboard data (mfg only)
router.get('/mfg', verifyAuth, verifyMfg, async (req, res) => {
  try {
    const syncedWallet = await syncWalletBalance(req.uid).catch(() => null);

    const { data: orders, error: ordersErr } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('mfg_id', req.uid);

    if (ordersErr) throw ordersErr;

    res.json({
      orders: orders || [],
      profile: {
        business_name: req.mfgData.business_name,
        wallet: syncedWallet || { balance: 0, total_earnings: 0, pending_balance: 0 }
      }
    });
  } catch (err) {
    console.error('Error fetching mfg dashboard stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch manufacturer stats' });
  }
});

export default router;
