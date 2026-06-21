import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyMfg, verifyAdmin, resolveAnyRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/manufacturers - List all manufacturers (admin only)
router.get('/', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('manufacturers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching manufacturers list:', err.message);
    res.status(500).json({ error: 'Failed to fetch manufacturers' });
  }
});

// GET /api/manufacturers/me - Get own profile (mfg)
router.get('/me', verifyAuth, verifyMfg, async (req, res) => {
  res.json(req.mfgData);
});

// PUT /api/manufacturers/me - Update own profile (mfg)
router.put('/me', verifyAuth, verifyMfg, async (req, res) => {
  try {
    const { business_name } = req.body;
    if (!business_name || !business_name.trim()) {
      return res.status(400).json({ error: 'Business name is required.' });
    }

    const { data, error } = await supabaseAdmin
      .from('manufacturers')
      .update({
        business_name: business_name.trim(),
        updated_at: new Date().toISOString()
      })
      .eq('id', req.uid)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, profile: data });
  } catch (err) {
    console.error('Error updating manufacturer profile:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/manufacturers/:id - Get specific manufacturer profile (admin/resolveAnyRole)
// GET /api/manufacturers/by-name/:name - Find email by business name (public)
router.get('/by-name/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { data, error } = await supabaseAdmin
      .from('manufacturers')
      .select('email')
      .eq('business_name', name)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'Manufacturer not found' });
    }
    res.json(data);
  } catch (err) {
    console.error('Error fetching manufacturer by name:', err.message);
    res.status(500).json({ error: 'Failed to fetch manufacturer' });
  }
});

router.get('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('manufacturers')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Manufacturer not found' });
    }

    res.json(data);
  } catch (err) {
    console.error('Error fetching manufacturer details:', err.message);
    res.status(500).json({ error: 'Failed to fetch manufacturer' });
  }
});

// PUT /api/manufacturers/:id - Update specific manufacturer (admin only)
router.put('/:id', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, business_name, email } = req.body;

    const updatePayload = {
      updated_at: new Date().toISOString()
    };
    if (status !== undefined) {
      updatePayload.status = status;
      if (status === 'deleted') {
        updatePayload.deleted_at = new Date().toISOString();
      }
    }
    if (business_name !== undefined) updatePayload.business_name = business_name.trim();
    if (email !== undefined) updatePayload.email = email.trim().toLowerCase();

    const { data, error } = await supabaseAdmin
      .from('manufacturers')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, manufacturer: data });
  } catch (err) {
    console.error('Error updating manufacturer:', err.message);
    res.status(500).json({ error: 'Failed to update manufacturer' });
  }
});

export default router;
