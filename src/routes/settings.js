import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin } from '../middleware/auth.js';

const router = express.Router();

// GET /api/settings - Fetch all settings (public)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('*');

    if (error) throw error;
    
    // Convert array to key-value object
    const settingsObj = {};
    (data || []).forEach(item => {
      settingsObj[item.key] = item.value;
    });
    res.json(settingsObj);
  } catch (err) {
    console.error('Error fetching settings:', err.message);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// GET /api/settings/:key - Fetch a specific setting (public)
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('*')
      .eq('key', key)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.json({ key, value: null });
    
    res.json(data);
  } catch (err) {
    console.error('Error fetching setting:', err.message);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// PUT /api/settings/:key - Update a setting (admin only)
router.put('/:key', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Value is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('settings')
      .upsert({
        key,
        value,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, setting: data });
  } catch (err) {
    console.error('Error saving setting:', err.message);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

export default router;
