import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyMfg, resolveAnyRole } from '../middleware/auth.js';
import { updateAllDesignPricesForBaseProduct, propagatePrintStyleCostToProducts } from '../utils/priceCalculator.js';

const router = express.Router();

// GET /api/print-styles - Fetch print styles (public)
router.get('/', async (req, res) => {
  try {
    const { mfg_id } = req.query;
    let query = supabaseAdmin.from('print_styles').select('*');

    if (mfg_id) {
      query = query.eq('mfg_id', mfg_id);
    }

    const { data, error } = await query.order('name', { ascending: true });

    if (error) throw error;

    const formatted = (data || []).map(row => {
      let desc = {};
      try {
        desc = JSON.parse(row.description);
      } catch (e) {}
      return {
        ...row,
        category: row.category || desc.category || 'DTF',
        placementCategories: desc.placementCategories || []
      };
    });

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching print styles:', err.message);
    res.status(500).json({ error: 'Failed to fetch print styles' });
  }
});

// POST /api/print-styles/bulk - Bulk sync print styles for manufacturer (requires auth + mfg)
router.post('/bulk', verifyAuth, verifyMfg, async (req, res) => {
  try {
    const { styles } = req.body;
    if (!styles || !Array.isArray(styles)) {
      return res.status(400).json({ error: 'Styles array is required' });
    }

    // 1. Delete all existing print styles for this mfg
    const { error: deleteError } = await supabaseAdmin
      .from('print_styles')
      .delete()
      .eq('mfg_id', req.uid);

    if (deleteError) throw deleteError;

    // 2. Insert new print styles
    const rowsToInsert = styles.map(s => {
      // Validate UUID if exists, otherwise generate or let db handle
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.id);
      return {
        ...(isUUID ? { id: s.id } : {}),
        mfg_id: req.uid,
        name: s.name.trim(),
        description: typeof s.description === 'string' ? s.description : JSON.stringify({
          cost: parseFloat(s.cost) || 0,
          category: s.category || 'DTF',
          description: s.description || '',
          placements: s.placements || [],
          customPlacements: s.customPlacements || [],
          placementCategories: s.placementCategories || []
        }),
        image: s.imageUrl || s.image || '',
        active: s.active !== undefined ? s.active : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    });

    if (rowsToInsert.length > 0) {
      const { data, error: insertError } = await supabaseAdmin
        .from('print_styles')
        .insert(rowsToInsert)
        .select();

      if (insertError) throw insertError;

      // Propagate updated costs to all products & designs for this manufacturer
      for (const savedStyle of data) {
        propagatePrintStyleCostToProducts(savedStyle.id, savedStyle).catch(e =>
          console.error(`[Bulk Sync] Price propagation failed for style ${savedStyle.id}:`, e.message)
        );
      }

      return res.json({ success: true, count: data.length, styles: data });
    }

    res.json({ success: true, count: 0, styles: [] });
  } catch (err) {
    console.error('Error syncing print styles:', err.message);
    res.status(500).json({ error: 'Failed to sync print styles' });
  }
});

// POST /api/print-styles - Create a single print style (requires auth + mfg)
router.post('/', verifyAuth, verifyMfg, async (req, res) => {
  try {
    const { name, cost, placements, customPlacements, placementCategories, imageUrl, active, category } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('print_styles')
      .insert({
        mfg_id: req.uid,
        name: name.trim(),
        description: JSON.stringify({
          cost: parseFloat(cost) || 0,
          category: category || 'DTF',
          placements: placements || [],
          customPlacements: customPlacements || [],
          placementCategories: placementCategories || []
        }),
        image: imageUrl || '',
        active: active !== undefined ? active : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    const formatted = {
      ...data,
      category: category || 'DTF'
    };
    res.json({ success: true, style: formatted });
  } catch (err) {
    console.error('Error creating print style:', err.message);
    res.status(500).json({ error: 'Failed to create print style' });
  }
});

// PUT /api/print-styles/:id - Update a single print style (requires auth + mfg or admin)
router.put('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, cost, placements, customPlacements, placementCategories, imageUrl, active, category } = req.body;

    // Fetch original to check ownership
    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('print_styles')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return res.status(404).json({ error: 'Print style not found' });
    }

    if (req.role !== 'admin' && original.mfg_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to update this print style.' });
    }

    const payload = {
      updated_at: new Date().toISOString()
    };

    if (name !== undefined) payload.name = name.trim();
    if (imageUrl !== undefined) payload.image = imageUrl;
    if (active !== undefined) payload.active = active;

    // Compile description JSON if any sub-fields are updated
    let currentDesc = {};
    try {
      currentDesc = JSON.parse(original.description);
    } catch (e) {
      currentDesc = { description: original.description || '' };
    }

    const newDesc = {
      cost: cost !== undefined ? parseFloat(cost) : (currentDesc.cost || 0),
      category: category !== undefined ? category : (currentDesc.category || 'DTF'),
      description: currentDesc.description || '',
      placements: placements !== undefined ? placements : (currentDesc.placements || []),
      customPlacements: customPlacements !== undefined ? customPlacements : (currentDesc.customPlacements || []),
      placementCategories: placementCategories !== undefined ? placementCategories : (currentDesc.placementCategories || [])
    };

    payload.description = JSON.stringify(newDesc);

    const { data, error } = await supabaseAdmin
      .from('print_styles')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Propagate updated cost to product snapshots, then recalculate all linked design prices
    propagatePrintStyleCostToProducts(id, data).catch(syncErr =>
      console.error('Error propagating print style cost to products:', syncErr.message)
    );

    const formatted = {
      ...data,
      category: newDesc.category
    };
    res.json({ success: true, style: formatted });
  } catch (err) {
    console.error('Error updating print style:', err.message);
    res.status(500).json({ error: 'Failed to update print style' });
  }
});

// DELETE /api/print-styles/:id - Delete a single print style (requires auth + mfg or admin)
router.delete('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch original to check ownership
    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('print_styles')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return res.status(404).json({ error: 'Print style not found' });
    }

    if (req.role !== 'admin' && original.mfg_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to delete this print style.' });
    }

    const { error } = await supabaseAdmin
      .from('print_styles')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Print style deleted successfully' });
  } catch (err) {
    console.error('Error deleting print style:', err.message);
    res.status(500).json({ error: 'Failed to delete print style' });
  }
});

export default router;
