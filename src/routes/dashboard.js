import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin, verifyDesigner, verifyMfg } from '../middleware/auth.js';

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
    const [designsRes, ordersRes, walletRes] = await Promise.all([
      supabaseAdmin.from('designs').select('*').eq('designer_id', req.uid),
      supabaseAdmin.from('orders').select('*').eq('designer_id', req.uid),
      supabaseAdmin.from('wallets').select('balance, total_earnings').eq('id', req.uid).maybeSingle()
    ]);

    if (designsRes.error) throw designsRes.error;
    if (ordersRes.error) throw ordersRes.error;
    if (walletRes.error) throw walletRes.error;

    res.json({
      designs: designsRes.data || [],
      orders: ordersRes.data || [],
      profile: {
        points: req.designerData.points || 0,
        total_earnings: req.designerData.total_earnings || 0,
        wallet: walletRes.data || { balance: 0, total_earnings: 0 }
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
    const [ordersRes, walletRes] = await Promise.all([
      supabaseAdmin.from('orders').select('*').eq('mfg_id', req.uid),
      supabaseAdmin.from('wallets').select('balance, total_earnings').eq('id', req.uid).maybeSingle()
    ]);

    if (ordersRes.error) throw ordersRes.error;
    if (walletRes.error) throw walletRes.error;

    res.json({
      orders: ordersRes.data || [],
      profile: {
        business_name: req.mfgData.business_name,
        wallet: walletRes.data || { balance: 0, total_earnings: 0 }
      }
    });
  } catch (err) {
    console.error('Error fetching mfg dashboard stats:', err.message);
    res.status(500).json({ error: 'Failed to fetch manufacturer stats' });
  }
});

export default router;
