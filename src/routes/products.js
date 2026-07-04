import express from 'express';
import { supabaseAdmin } from '../supabaseAdmin.js';
import { verifyAuth, verifyAdmin, verifyMfg, resolveAnyRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/products - List all available products (public)
router.get('/', async (req, res) => {
  try {
    const { category, gender } = req.query;
    let query = supabaseAdmin
      .from('products')
      .select('*')
      .eq('available', true);

    if (category) {
      query = query.eq('category', category);
    }
    if (gender) {
      query = query.eq('gender', gender);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    res.set('Cache-Control', 'no-store');
    res.json(data || []);
  } catch (err) {
    console.error('Error fetching available products:', err.message);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/products/mfg - Get products for logged-in manufacturer (requires verifyAuth + verifyMfg)
router.get('/mfg', verifyAuth, verifyMfg, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('mfg_id', req.uid)
      .order('created_at', { ascending: false });

    if (error) throw error;
    const activeProducts = (data || []).filter(p => {
      const details = Array.isArray(p.details) ? p.details : [];
      return !details.includes('__DELETED__');
    });
    res.set('Cache-Control', 'no-store');
    res.json(activeProducts);
  } catch (err) {
    console.error('Error fetching manufacturer products:', err.message);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

// GET /api/products/:id - Get single base product details (public)
router.get('/:id', async (req, res) => {
  console.log(`[DEBUG] Route hit: GET /api/products/${req.params.id}`);
  try {
    const { id } = req.params;
    console.log(`[DEBUG] Executing Supabase query: from('products').select('*').eq('id', '${id}').single()`);
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error(`[DEBUG] Supabase query error:`, error);
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Product not found' });
      }
      throw error;
    }
    if (!data) {
      console.log(`[DEBUG] Query returned no data (falsy) for product ${id}`);
      return res.status(404).json({ error: 'Product not found' });
    }
    console.log(`[DEBUG] Supabase query success for product ${id}`);
    res.set('Cache-Control', 'no-store');
    res.json(data);
  } catch (err) {
    console.error(`[DEBUG] Exception in GET /api/products/:id:`, err.stack);
    res.status(500).json({ error: 'Failed to fetch product details' });
  }
});

// POST /api/products - Create product (requires verifyAuth + verifyMfg)
router.post('/', verifyAuth, verifyMfg, async (req, res) => {
  try {
    const {
      title,
      category,
      cost,
      gender,
      cover_image,
      colors,
      printing_styles,
      size_chart_image,
      sizes,
      available,
      details,
      wash_care
    } = req.body;

    if (!title || !category || cost === undefined) {
      return res.status(400).json({ error: 'Required fields: title, category, cost' });
    }

    const payload = {
      title: title.trim(),
      category,
      cost: parseFloat(cost) || 0,
      gender: gender || 'Unisex',
      cover_image: cover_image || '',
      colors: colors || [],
      printing_styles: printing_styles || [],
      size_chart_image: size_chart_image || '',
      sizes: sizes || [],
      details: details || [],
      wash_care: wash_care || [],
      mfg_id: req.uid,
      mfg_name: req.mfgData.business_name || '',
      available: available !== undefined ? available : true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    res.json({ success: true, product: data });
  } catch (err) {
    console.error('Error creating product:', err.message);
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id - Update product (requires verifyAuth + verifyMfg or verifyAdmin)
router.put('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      category,
      cost,
      gender,
      cover_image,
      colors,
      printing_styles,
      size_chart_image,
      sizes,
      available,
      details,
      wash_care
    } = req.body;

    // Check ownership or admin
    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    if (req.role !== 'admin' && original.mfg_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to update this product.' });
    }

    const payload = {
      updated_at: new Date().toISOString()
    };

    if (title !== undefined) payload.title = title.trim();
    if (category !== undefined) payload.category = category;
    if (cost !== undefined) payload.cost = parseFloat(cost) || 0;
    if (gender !== undefined) payload.gender = gender;
    if (cover_image !== undefined) payload.cover_image = cover_image;
    if (colors !== undefined) payload.colors = colors;
    if (printing_styles !== undefined) payload.printing_styles = printing_styles;
    if (size_chart_image !== undefined) payload.size_chart_image = size_chart_image;
    if (sizes !== undefined) payload.sizes = sizes;
    if (available !== undefined) payload.available = available;
    if (details !== undefined) payload.details = details;
    if (wash_care !== undefined) payload.wash_care = wash_care;

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('products')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;
    res.json({ success: true, product: updated });
  } catch (err) {
    console.error('Error updating product:', err.message);
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id - Delete product (requires verifyAuth + verifyMfg or verifyAdmin)
router.delete('/:id', verifyAuth, resolveAnyRole, async (req, res) => {
  try {
    const { id } = req.params;

    // Check ownership or admin
    const { data: original, error: fetchErr } = await supabaseAdmin
      .from('products')
      .select('mfg_id, details')
      .eq('id', id)
      .single();

    if (fetchErr || !original) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    if (req.role !== 'admin' && original.mfg_id !== req.uid) {
      return res.status(403).json({ error: 'Unauthorized to delete this product.' });
    }

    const currentDetails = Array.isArray(original.details) ? original.details : [];
    if (!currentDetails.includes('__DELETED__')) {
      currentDetails.push('__DELETED__');
    }

    const { error } = await supabaseAdmin
      .from('products')
      .update({
        available: false,
        details: currentDetails,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;
    res.json({ success: true, message: 'Product deleted successfully.' });
  } catch (err) {
    console.error('Error deleting product:', err.message);
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

export default router;
