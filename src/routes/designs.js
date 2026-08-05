import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyDesigner, verifyAdmin, resolveAnyRole } from '../middleware/auth.js';
import { syncDesignPriceWithBaseProduct } from '../utils/priceCalculator.js';

const router = express.Router();

// Helper: check if a design has been hidden by the designer (stored in description JSON)
const isDesignHidden = (design) => {
  try {
    if (design.description && typeof design.description === 'string' && design.description.startsWith('{')) {
      return JSON.parse(design.description).isHidden === true;
    }
  } catch (e) {}
  return false;
};

// GET /api/designs - List approved designs (public)
router.get('/', async (req, res) => {
  try {
    const { designerId, sort, limit } = req.query;
    let query = supabaseAdmin
      .from('designs')
      .select('*, products:base_product_id(cost, printing_styles, category, available, details), catalogue:catalogue_item_id(category)')
      .in('status', ['approved', 'active']);

    if (designerId) {
      query = query.eq('designer_id', designerId);
    }

    let orderColumn = 'created_at';
    if (sort === 'orders_count') {
      orderColumn = 'orders_count';
    }

    let dbQuery = query.order(orderColumn, { ascending: false });
    if (limit) {
      dbQuery = dbQuery.limit(parseInt(limit, 10));
    }

    const { data, error } = await dbQuery;
    if (error) throw error;

    // Fetch designer status map to filter out suspended or blocked designers
    const { data: designers } = await supabaseAdmin.from('designers').select('id, status');
    const inactiveDesignerIds = new Set(
      (designers || [])
        .filter(d => d.status === 'suspended' || d.status === 'blocked' || d.status === 'restricted')
        .map(d => d.id)
    );

    const activeDesigns = (data || [])
      .filter(d => {
        if (inactiveDesignerIds.has(d.designer_id)) return false;
        if (isDesignHidden(d)) return false;
        if (d.products) {
          const details = Array.isArray(d.products.details) ? d.products.details : [];
          return d.products.available !== false && !details.includes('__DELETED__');
        }
        return true;
      })
      .map(d => syncDesignPriceWithBaseProduct(d));

    res.json(activeDesigns);
  } catch (err) {
    console.error('Error fetching designs:', err.message);
    res.status(500).json({ error: 'Failed to fetch designs' });
  }
});

// GET /api/designs/mine - List designer's own designs (requires designer role)
router.get('/mine', verifyAuth, verifyDesigner, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('designs')
      .select('*, products:base_product_id(cost, printing_styles, category, available, details)')
      .eq('designer_id', req.uid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    const synced = (data || []).map(d => syncDesignPriceWithBaseProduct(d));
    res.json(synced);
  } catch (err) {
    console.error('Error fetching my designs:', err.message);
    res.status(500).json({ error: 'Failed to fetch my designs' });
  }
});

// GET /api/designs/all - List all designs (admin)
router.get('/all', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('designs')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching all designs:', err.message);
    res.status(500).json({ error: 'Failed to fetch all designs' });
  }
});

// GET /api/designs/:id - Get single design details (public/private-for-owner-admin)
router.get('/:id', async (req, res) => {
  console.log(`[DEBUG] Route hit: GET /api/designs/${req.params.id}`);
  try {
    const { id } = req.params;
    console.log(`[DEBUG] Executing Supabase query: from('designs').select('*, designers:designer_id(full_name, username)').eq('id', '${id}').single()`);
    const { data, error } = await supabaseAdmin
      .from('designs')
      .select('*, designers:designer_id(full_name, username), products:base_product_id(cost, printing_styles, available, details)')
      .eq('id', id)
      .single();

    if (error) {
      console.error(`[DEBUG] Supabase query error:`, error);
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Design not found' });
      }
      throw error;
    }
    if (!data) {
      console.log(`[DEBUG] Query returned no data (falsy) for design ${id}`);
      return res.status(404).json({ error: 'Design not found' });
    }

    // Optional auth token check to let Admins and Owners bypass public visibility checks
    let userRole = null;
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      try {
        const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
        if (user && !authErr) {
          userId = user.id;
          // check if admin
          const { data: admin } = await supabaseAdmin.from('admins').select('*').eq('id', user.id).maybeSingle();
          if (admin) {
            userRole = 'admin';
          } else {
            const { data: mfg } = await supabaseAdmin.from('manufacturers').select('*').eq('id', user.id).maybeSingle();
            if (mfg) {
              userRole = 'mfg';
            } else {
              const { data: designer } = await supabaseAdmin.from('designers').select('*').eq('id', user.id).maybeSingle();
              if (designer) {
                userRole = 'designer';
              }
            }
          }
        }
      } catch (authCatchErr) {
        console.error('[DEBUG] Optional auth parsing error:', authCatchErr.message);
      }
    }

    const isAdmin = userRole === 'admin';
    const isMfg = userRole === 'mfg';
    const isOwner = userRole === 'designer' && data.designer_id === userId;

    if (!isAdmin && !isMfg && !isOwner) {
      if (data.products) {
        const details = Array.isArray(data.products.details) ? data.products.details : [];
        if (data.products.available === false || details.includes('__DELETED__')) {
          return res.status(404).json({ error: 'Design unavailable' });
        }
      }
      // Block access if designer has hidden this design
      if (isDesignHidden(data)) {
        return res.status(404).json({ error: 'Design not found' });
      }
    }

    console.log(`[DEBUG] Supabase query success for design ${id}`);
    const synced = syncDesignPriceWithBaseProduct(data);
    res.json(synced);
  } catch (err) {
    console.error(`[DEBUG] Exception in GET /api/designs/:id:`, err.stack);
    res.status(500).json({ error: 'Failed to fetch design details' });
  }
});

// POST /api/designs - Submit new design (designer)
router.post('/', verifyAuth, verifyDesigner, async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      base_product_id,
      images,
      colors,
      sizes,
      gender,
      collection,
      category,
      tags
    } = req.body;

    if (!title || price === undefined) {
      return res.status(400).json({ error: 'Required fields: title, price' });
    }

    const designPayload = {
      title: title.trim(),
      description,
      price: parseFloat(price) || 0,
      base_product_id: base_product_id || null,
      designer_id: req.uid,
      designer_username: req.designerData.username || req.user.email.split('@')[0],
      images: images || [],
      colors: colors || [],
      sizes: sizes || [],
      gender: gender || 'unisex',
      status: 'pending',
      collection: collection || 'Default',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    if (category) designPayload.category = category;
    if (tags) designPayload.tags = tags;

    const { data, error } = await supabaseAdmin
      .from('designs')
      .insert(designPayload)
      .select()
      .single();

    if (error) throw error;

    // Optional: increment designer's design count
    const currentCount = Number(req.designerData.designs_count || 0);
    await supabaseAdmin
      .from('designers')
      .update({ designs_count: currentCount + 1 })
      .eq('id', req.uid);

    res.json({ success: true, design: data });
  } catch (err) {
    console.error('Error submitting design:', err.message);
    res.status(500).json({ error: 'Failed to submit design' });
  }
});

// PUT /api/designs/:id - Update design (designer/admin)
router.put('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      price,
      base_product_id,
      images,
      colors,
      sizes,
      gender,
      collection,
      status
    } = req.body;

    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('designs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return res.status(404).json({ error: 'Design not found.' });
    }

    // Only designer of design OR admin can update
    if (req.role !== 'admin' && original.designer_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to update this design.' });
    }

    const payload = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) payload.title = title.trim();
    if (description !== undefined) payload.description = description;
    if (price !== undefined) payload.price = parseFloat(price) || 0;
    if (base_product_id !== undefined) payload.base_product_id = base_product_id;
    if (images !== undefined) payload.images = images;
    if (colors !== undefined) payload.colors = colors;
    if (sizes !== undefined) payload.sizes = sizes;
    if (gender !== undefined) payload.gender = gender;
    if (collection !== undefined) payload.collection = collection;

    // Only admin can change status through general PUT or specific status PUT
    if (status !== undefined) {
      if (req.role === 'admin') {
        payload.status = status;
      } else {
        return res.status(403).json({ error: 'Only admins can change design status.' });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('designs')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, design: data });
  } catch (err) {
    console.error('Error updating design:', err.message);
    res.status(500).json({ error: 'Failed to update design' });
  }
});

// PUT /api/designs/:id/status - Approve/reject/update status (admin)
router.put('/:id/status', verifyAuth, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejection_reason } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }

    const updatePayload = {
      status,
      reviewed_by: req.uid,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (rejection_reason !== undefined) {
      updatePayload.rejection_reason = rejection_reason;
    }

    const { data, error } = await supabaseAdmin
      .from('designs')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, design: data });
  } catch (err) {
    console.error('Error changing design status:', err.message);
    res.status(500).json({ error: 'Failed to change design status' });
  }
});

// DELETE /api/designs/:id - Delete design (designer/admin)
router.delete('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('designs')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return res.status(404).json({ error: 'Design not found.' });
    }

    if (req.role !== 'admin' && original.designer_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to delete this design.' });
    }

    const { error } = await supabaseAdmin
      .from('designs')
      .delete()
      .eq('id', id);

    if (error) throw error;

    // Optional: decrement designer's design count
    if (original.designer_id) {
      const { data: designer } = await supabaseAdmin
        .from('designers')
        .select('designs_count')
        .eq('id', original.designer_id)
        .maybeSingle();

      if (designer) {
        const currentCount = Number(designer.designs_count || 0);
        await supabaseAdmin
          .from('designers')
          .update({ designs_count: Math.max(0, currentCount - 1) })
          .eq('id', original.designer_id);
      }
    }

    res.json({ success: true, message: 'Design deleted successfully.' });
  } catch (err) {
    console.error('Error deleting design:', err.message);
    res.status(500).json({ error: 'Failed to delete design' });
  }
});

export default router;
